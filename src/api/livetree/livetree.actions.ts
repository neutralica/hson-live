import type { HsonNode } from "../../core/types.js";
import type { LiveTreeActionContext, LiveTreeActions } from "../../types/livetree-action.types.js";
import type { InteractionListener } from "../../types/interaction.descriptor.types.js";
import { _throw_transform_err } from "../../core/errors.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import { event_source_position, parse_authored_event } from "../../internal/authored-events.js";
import { make_local_actions } from "../../internal/local-actions.js";
import { hson_data_from_value } from "../data/hson-data.js";
import { create_staged_livetree_in_runtime } from "./creation/create-livetree.js";
import { parent_for_node } from "./lifecycle/graph-ownership.js";
import { assert_mutation_publication_available } from "./lifecycle/mutation-publication.js";
import { assert_livetree_node_active, observe_livetree_node_terminal } from "./livetree-state.js";
import type { LiveTree } from "./livetree.js";
import {
  active_subject_for_tree,
  report_livetree_runtime_failure,
  runtime_for_node,
  runtime_for_tree,
} from "./runtime/livetree-runtime.js";

type EventSource = Required<Pick<LiveTreeActionContext, "subject" | "event">>;
type ActionEnvironment = ReturnType<typeof make_local_actions<LiveTreeActionContext, EventSource>>;

const rootHandles = new WeakMap<HsonNode, WeakRef<LiveTree>>();
const actionEnvironments = new WeakMap<HsonNode, ActionEnvironment>();

/** Keep the original root handle available for context without retaining unused handles. @internal */
export function remember_livetree_action_root(tree: LiveTree, node: HsonNode): void {
  if (parent_for_node(node) === undefined && rootHandles.get(node)?.deref() === undefined) {
    rootHandles.set(node, new WeakRef(tree));
  }
}

function actionRootFor(subject: HsonNode): HsonNode {
  assert_mutation_publication_available(subject);
  // Current graph ownership keeps aliases in sync through detach and reattachment.
  let root = subject;
  for (let parent = parent_for_node(subject); parent !== undefined; parent = parent_for_node(parent)) {
    // Relationship wrappers and borrowed carriers without a tree handle do not own an environment.
    if (rootHandles.has(parent) || is_ordinary_element_node(parent)) root = parent;
  }
  return root;
}

export function livetree_actions_for(tree: LiveTree): LiveTreeActions {
  const subject = active_subject_for_tree(tree);
  const root = actionRootFor(subject);
  const runtime = runtime_for_tree(tree);
  let environment = actionEnvironments.get(root);
  if (environment === undefined) {
    // Wrap an already-owned root without minting identity if no handle remains.
    const owner = rootHandles.get(root)?.deref()
      ?? (root === subject ? tree : create_staged_livetree_in_runtime(root, runtime));
    environment = make_local_actions<LiveTreeActionContext, EventSource>(
      source => source === undefined ? { tree: owner } : { tree: owner, subject: source.subject, event: source.event },
      () => {
        assert_livetree_node_active(root, "use actions");
        if (runtime_for_node(root) !== runtime) throw new Error("LiveTree action owner is no longer active in its runtime.");
      },
    );
    actionEnvironments.set(root, environment);
    observe_livetree_node_terminal(root, () => {
      actionEnvironments.delete(root);
      rootHandles.delete(root);
    });
  }
  return environment.registry;
}

export function parse_livetree_authored_event(source: string): Readonly<{
  listener: InteractionListener;
  bind: (tree: LiveTree) => Readonly<{ actionOwner: HsonNode; handler: EventListener }>;
}> {
  const { kind, key, listener, input } = parse_authored_event(source, "LiveTree.listen.event");
  if (kind !== "browser") {
    throw new TypeError("LiveTree.listen.event requires a local: action. A standalone LiveTree cannot dispatch host: actions.");
  }
  if (input?.kind === "reference") {
    return _throw_transform_err("Standalone event input cannot resolve %{} or ^{} references. Supply a Data literal.",
      "LiveTree.listen.event", undefined, undefined, {
        code: "HSON_EVENT_REFERENCE_INVALID", stage: "source-admission", source: event_source_position(input.start),
        related: [{ role: "value-end", source: event_source_position(input.end) }],
      });
  }
  const data = input === undefined ? undefined : hson_data_from_value(input.value);
  const onFailure = (cause: unknown) =>
    report_livetree_runtime_failure(`LiveTree action ${JSON.stringify(key)} failed during event dispatch.`, cause);
  return {
    listener,
    bind(tree) {
      const actionOwner = actionRootFor(active_subject_for_tree(tree));
      const action = actionEnvironments.get(actionOwner)?.resolve(key);
      if (action === undefined) {
        throw new Error(`Unknown local action ${JSON.stringify(key)}. Define it on tree.actions before calling tree.listen.event().`);
      }
      // The native registration retains the resolved capability through reversible detach.
      const invoke = action.bindInput(data);
      return { actionOwner, handler: event => { void invoke({ subject: tree, event, onFailure }); } };
    },
  };
}
