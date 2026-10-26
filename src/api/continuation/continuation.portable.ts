import { collect_subtree_nodes } from "../livetree/utils/subtree-traversal.js";
import { get_el_for_node } from "../livetree/utils/node-map-helpers.js";
import type { ExactDocumentAdoption } from "./continuation.adopt.js";
import type { PortableDocumentHandoff } from "../livemap/livemap.internal.js";
import { active_subject_for_tree } from "../livetree/runtime/livetree-runtime.js";
import { begin_mutation_publication } from "../livetree/lifecycle/mutation-publication.js";
import { plan_browser_realization } from "../../internal/browser-realization/browser-realization-plan.js";
import { plan_managed_document_css, write_managed_document_css } from "../../internal/browser-realization/managed-document-css.js";
import { assert_browser_realization_mappings, browser_parent_namespace_for_target, match_browser_realization_root } from "../../internal/browser-realization/browser-realization-dom.js";

/** Native realization of an already validated, owner-prepared handoff. @internal */
export function prepare_portable_native_handoff(adoption: ExactDocumentAdoption, handoff: Pick<PortableDocumentHandoff, "portableCss" | "receivingCss" | "assertCurrent">
  & Partial<Pick<PortableDocumentHandoff, "acceptCss">>): Readonly<{
  apply: () => void;
  rollback: () => void;
  finish: () => void;
}> {
  const subjects = adoption.portableSubjects;
  const styles = adoption.managedStyles;
  if (handoff.receivingCss.length !== styles.length || handoff.portableCss.length !== styles.length) throw new Error("Portable CSS handoff lost its exact managed styles.");
  const root = adoption.tree.dom.el(), subject = active_subject_for_tree(adoption.tree);
  if (root === undefined) throw new Error("Portable handoff lost its admitted root.");
  const receivingSubjects = collect_subtree_nodes(subject, "pre").flatMap(node => {
    const element = get_el_for_node(node), quid = node.$_meta?.quid;
    return element === undefined || quid === undefined ? [] : [{ element, quid }];
  });
  // Prepare final realization before accepting authority or invalidating the
  // portable match. Initial publication requires exact runtime metadata too;
  // Mirror's borrowed matcher tolerates already-owned runtime attributes.
  const receivingPlan = plan_managed_document_css(plan_browser_realization(subject, {
    capability: "dom", parentNamespace: browser_parent_namespace_for_target(root, subject.$_tag),
  }), handoff.receivingCss);
  let started = false;
  let endPublication = () => {};
  return Object.freeze({
    apply: () => {
      handoff.assertCurrent();
      endPublication = begin_mutation_publication([subject], styles);
      started = true;
      handoff.acceptCss?.();
      // No await, scheduling, or style read occurs here. Even a synchronous
      // native callback that flushes style still has a matching selector: QUAD
      // until the style switch, QUID from the switch through carrier removal.
      for (const { element, quid } of receivingSubjects) {
        element.setAttribute("hson:quid", quid);
        if (element.getAttribute("hson:quid") !== quid) throw new Error("Receiving identity metadata write did not realize its subject.");
        handoff.assertCurrent();
      }
      styles.forEach((style, index) => {
        write_managed_document_css(style, handoff.receivingCss[index]!);
        if (style.textContent !== handoff.receivingCss[index]) throw new Error("Receiving stylesheet write did not realize Library CSS.");
      });
      handoff.assertCurrent();
      for (const { element } of subjects) {
        element.removeAttribute("hson:quad");
        handoff.assertCurrent();
      }
      assert_browser_realization_mappings(match_browser_realization_root(receivingPlan, root));
      handoff.assertCurrent();
    },
    rollback: () => {
      if (!started) return;
      const failures: unknown[] = [];
      // Reestablish the portable selector targets before restoring their CSS.
      // Record every subject up front: setters can throw after making a write.
      for (const { element, name } of subjects) {
        try {
          if (element.getAttribute("hson:quad") !== name) element.setAttribute("hson:quad", name);
          if (element.getAttribute("hson:quad") !== name) throw new Error("Portable carrier rollback did not realize its subject.");
        }
        catch (cause) { failures.push(cause); }
      }
      styles.forEach((style, index) => {
        try {
          write_managed_document_css(style, handoff.portableCss[index]!);
          if (style.textContent !== handoff.portableCss[index]) throw new Error("Portable stylesheet rollback did not realize its CSS.");
        } catch (cause) { failures.push(cause); }
      });
      for (const { element } of receivingSubjects) {
        try {
          if (element.hasAttribute("hson:quid")) element.removeAttribute("hson:quid");
          if (element.hasAttribute("hson:quid")) throw new Error("Receiving identity metadata survived rollback.");
        }
        catch (cause) { failures.push(cause); }
      }
      if (failures.length) throw new AggregateError(failures, "Portable native handoff rollback failed.");
      started = false;
    },
    finish: () => { endPublication(); endPublication = () => {}; },
  });
}
