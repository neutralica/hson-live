// assert-attrs.ts

// import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

// export function assert_no_attr_assignment_in_tail(tail: string, tag: string): void {
//   let inQuote = false;
//   let escaped = false;

//   for (let i = 0; i < tail.length; i++) {
//     const ch = tail[i];

//     if (escaped) {
//       escaped = false;
//       continue;
//     }

//     if (ch === "\\") {
//       escaped = true;
//       continue;
//     }

//     if (ch === '"') {
//       inQuote = !inQuote;
//       continue;
//     }

//     if (inQuote) continue;

//     if (/[A-Za-z_:]/.test(ch)) {
//       const start = i;
//       i++;

//       while (i < tail.length && /[A-Za-z0-9:._-]/.test(tail[i])) {
//         i++;
//       }

//       let j = i;
//       while (j < tail.length && /\s/.test(tail[j])) {
//         j++;
//       }

//       if (tail[j] === "=") {
//         const name = tail.slice(start, i);

//         _throw_transform_err(
//           `[step f] attribute "${name}" appears after content in <${tag}>`,
//           "tokenize_hson.stepF"
//         );
//       }

//       i = i - 1;
//     }
//   }
// }