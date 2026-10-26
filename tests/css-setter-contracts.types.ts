import type { CssMap } from '../src/types/css.types.js';
import type { DocumentCssRuleHandle, DocumentCssRuleCommands } from '../src/types/document-css.types.js';
import type { CssGlobalRuleHandle } from '../src/types/css.types.js';
import type { AsyncLiveTreeCssRule } from '../src/api/livetree/async-livetree.js';
import type { LiveTree } from '../src/api/livetree/livetree.js';
import { hsonLiveMap } from '../src/api/livemap/index.js';
declare const css: CssMap;
declare const row: LiveTree;
declare const documentRule: DocumentCssRuleHandle;
declare const commands: DocumentCssRuleCommands<Promise<void>>;
declare const bound: CssGlobalRuleHandle;
declare const asyncRule: AsyncLiveTreeCssRule<LiveTree>;
row.create.span().css.setMany(css);
documentRule.setMany(css);
void commands.sel('.row').setMany(css);
bound.setMany(css);
void asyncRule.setMany(css);

declare const declarationOrTypo: { color: string } | { colour: string };
declare const declarationOrSubject: { color: string } | { '@:child': { color: string } };
declare const declarationOrMedia: { color: string } | { $media: { screen: { color: string } } };
type ConditionalCss<T extends boolean> = T extends true ? { color: string } : { colour: string };
declare const conditionalCss: ConditionalCss<boolean>;
declare const validUnion: Readonly<{ color: string }> | Readonly<{ opacity: number }>;
declare const optionalReadonly: Readonly<{ color?: string | undefined; _hover?: Readonly<{ opacity?: number | undefined }> | undefined }>;

// Valid unions and optional readonly members retain the structured authoring contract.
row.css.setMany({ _hover: validUnion, '& > p': validUnion, '@:item': validUnion, $media: { screen: validUnion } });
row.css.setMany(optionalReadonly);
row.style.setMany({ color: undefined, width: { value: 2, unit: undefined } });
documentRule.setMany({ _focus: validUnion });
hsonLiveMap.fromLibraries({ parts: { parts: { p: { kind: 'document', document: '<p/>', css: { _hover: validUnion } } } } });

// A required union must retain evidence from its declaration-only member.
// @ts-expect-error a declaration branch cannot hide a misspelled declaration
row.css.setMany({ _hover: declarationOrTypo });
// @ts-expect-error explicit type arguments retain recursive union validation
row.css.setMany<{ _hover: typeof declarationOrTypo }>({ _hover: declarationOrTypo });
// @ts-expect-error relative selector entries validate every required union
row.css.setMany({ '& > p': declarationOrTypo });
// @ts-expect-error subject entries validate every required union
row.css.setMany({ '@:item': declarationOrTypo });
// @ts-expect-error media entries validate every required union
row.css.setMany({ $media: { screen: declarationOrTypo } });
// @ts-expect-error conditional types retain their invalid alternative
row.css.setMany({ _hover: conditionalCss });
// @ts-expect-error a declaration branch cannot hide a forbidden nested subject
row.css.setMany({ _hover: declarationOrSubject });
// @ts-expect-error a declaration branch cannot hide a forbidden nested media group
row.css.setMany({ _hover: declarationOrMedia });
// @ts-expect-error subject rules cannot contain another subject through a union
row.css.setMany({ '@:item': declarationOrSubject });
// @ts-expect-error media rules cannot contain another media group through a union
row.css.setMany({ $media: { screen: declarationOrMedia } });
// @ts-expect-error selector setters share recursive union validation
row.css.selector('& > p').setMany({ _hover: declarationOrTypo });
// @ts-expect-error Document setters share recursive union validation
documentRule.setMany({ _hover: declarationOrTypo });
// @ts-expect-error Document command setters share recursive union validation
void commands.sel('.row').setMany({ _hover: declarationOrTypo });
// @ts-expect-error bound global setters share recursive union validation
bound.setMany({ _hover: declarationOrTypo });
// @ts-expect-error global selectors share recursive union validation
row.css.global.sel('.row').setMany({ _hover: declarationOrTypo });
// @ts-expect-error async setters share recursive union validation
void asyncRule.setMany({ _hover: declarationOrTypo });
// @ts-expect-error Parts admission shares recursive union validation
hsonLiveMap.fromLibraries({ parts: { parts: { p: { kind: 'document', document: '<p/>', css: { _hover: declarationOrTypo } } } } });
