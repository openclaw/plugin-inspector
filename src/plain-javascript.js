import { tokTypes as tt } from "acorn";

// Whether Node's type stripping (strip mode) would return a source unchanged,
// decided from the tokens of a successful JavaScript parse.
//
// Strip mode only ever blanks TypeScript syntax, and a source that parses as
// JavaScript can only contain TypeScript syntax where the TypeScript grammar
// reads the same tokens differently. That happens at a small set of places,
// each refused here (refusing is always safe: the caller then strips as usual):
//
// - Type arguments: `f<T>(x)`, `f<g<T>>(x)`, `new C<T>()`, ``f<T>`x` ``,
//   `a?.b<T>(x)` and instantiation expressions such as `a<b>` before a line
//   break. Any `<` or `<<` followed by a closing `>` with only tokens that can
//   occur in types in between is refused, whatever follows it.
// - Arrow functions with return types, `cond ? (a): T => b` and
//   `case (a): b => c`: a parenthesis that opens an expression and closes
//   right before a colon.
// - Declarations introduced by contextual keywords, which the stripper
//   recognizes across line breaks (`declare\nconst x = 1` is blanked):
//   `declare`, `namespace`, `type`, `abstract` and their kind, followed by a
//   line break or by a word, literal or brace.
// - A non-null assertion `x!` that JavaScript reads as a prefix `!` after a
//   line break.
// - HTML-like comments, which only scripts treat as comments.
// - A byte order mark, which the stripper removes.
//
// Sources the stripper rejects as invalid TypeScript (for example `with`,
// legacy octal literals or a top-level return) never change the result: the
// caller then keeps every import and the text as written, exactly as for an
// unchanged source, and transform mode rejects them the same way.

const NAME = 1;
const CONTEXTUAL = 2; // a contextual TypeScript keyword spelled as a plain name
const ASYNC = 3;
const WORD = 4; // any other keyword except the ones below
const EXPRESSION_KEYWORD = 5; // this, super, import: a following ( is a call
const RELATION_KEYWORD = 6; // in, instanceof, of: a word that can follow a name
const STRING = 7; // string, number and template literals
const PAREN_L = 8;
const PAREN_R = 9;
const BRACKET_L = 10;
const BRACKET_R = 11;
const BRACE_L = 12; // { and ${
const BRACE_R = 13;
const LESS = 14; // < and <<
const GREATER = 15; // >, >>, >>>, >=, >>=, >>>=
const TYPE_PUNCTUATION = 16; // . , | & ? : => ... + -
const COLON = 17;
const SEMICOLON = 18;
const BANG = 19;
const OTHER = 20; // anything that cannot occur in a type
const QUESTION = 21;
const EXTENDS = 22;
const INC_DEC = 23; // ++ and --
const EQ = 24; // =
const ARROW = 25;
const STATEMENT_KEYWORD = 26; // else, do, export, default

const CONTEXTUAL_NAMES = new Set([
  "abstract", "accessor", "asserts", "declare", "enum", "global", "implements", "infer", "interface", "is",
  "keyof", "module", "namespace", "out", "override", "package", "private", "protected", "public", "readonly",
  "satisfies", "type", "unique",
]);

function tokenKind(token) {
  const type = token.type;
  if (type === tt.name) {
    if (token.value === "of") return RELATION_KEYWORD;
    if (token.value === "async") return ASYNC;
    return CONTEXTUAL_NAMES.has(token.value) ? CONTEXTUAL : NAME;
  }
  if (type.keyword !== undefined) {
    if (type === tt._this || type === tt._super || type === tt._import) return EXPRESSION_KEYWORD;
    if (type === tt._in || type === tt._instanceof) return RELATION_KEYWORD;
    if (type === tt._extends) return EXTENDS;
    if (type === tt._else || type === tt._do || type === tt._export || type === tt._default) return STATEMENT_KEYWORD;
    return WORD;
  }
  switch (type) {
    case tt.string: case tt.num: case tt.template: case tt.invalidTemplate: case tt.backQuote: return STRING;
    case tt.parenL: return PAREN_L;
    case tt.parenR: return PAREN_R;
    case tt.bracketL: return BRACKET_L;
    case tt.bracketR: return BRACKET_R;
    case tt.braceL: case tt.dollarBraceL: return BRACE_L;
    case tt.braceR: return BRACE_R;
    case tt.colon: return COLON;
    case tt.semi: return SEMICOLON;
    case tt.question: return QUESTION;
    case tt.arrow: return ARROW;
    case tt.incDec: return INC_DEC;
    case tt.eq: return EQ;
    case tt.dot: case tt.comma: case tt.bitwiseOR: case tt.bitwiseAND:
    case tt.ellipsis: case tt.plusMin: return TYPE_PUNCTUATION;
    case tt.prefix: return token.value === "!" ? BANG : OTHER;
    case tt.relational: return token.value[0] === "<" ? (token.value === "<" ? LESS : OTHER) : GREATER;
    case tt.bitShift: return token.value === "<<" ? LESS : GREATER;
    case tt.assign: return token.value[0] === ">" ? GREATER : OTHER;
    default: return OTHER;
  }
}

// Records tokens compactly while acorn parses (pass `onToken`), then answers
// `isPlain()` once the parse has succeeded.
export function plainJavaScriptTokens(text) {
  let kinds = new Uint8Array(1024);
  let bounds = new Int32Array(2048);
  let count = 0;
  const onToken = (token) => {
    if (token.type === tt.eof) return;
    if (count === kinds.length) {
      const grownKinds = new Uint8Array(kinds.length * 2);
      grownKinds.set(kinds);
      kinds = grownKinds;
      const grownBounds = new Int32Array(bounds.length * 2);
      grownBounds.set(bounds);
      bounds = grownBounds;
    }
    kinds[count] = tokenKind(token);
    bounds[count * 2] = token.start;
    bounds[count * 2 + 1] = token.end;
    count += 1;
  };
  // `<!--` anywhere and `-->` at the start of a line are comments in scripts
  // only; the stripper reads them as operators.
  let htmlComment = false;
  const onComment = (block, _text, start) => {
    if (!block && (text.startsWith("<!--", start) || text.startsWith("-->", start))) htmlComment = true;
  };
  // The stripper also drops a byte order mark.
  const isPlain = () => !htmlComment && !text.includes("\uFEFF") && isPlainTokenStream(text, kinds, bounds, count);
  return { onToken, onComment, isPlain };
}

const LINE_BREAK = /[\n\r\u2028\u2029]/;
// A possible type argument list is followed this far before it is refused.
const MAX_TYPE_ARGUMENT_TOKENS = 4096;

function isPlainTokenStream(text, kinds, bounds, count) {
  const lineBreakBefore = (index) => index < count && LINE_BREAK.test(text.slice(bounds[index * 2 - 2], bounds[index * 2]));
  const closing = matchingParentheses(kinds, count);
  for (let index = 0; index < count; index += 1) {
    const kind = kinds[index];
    const previous = index > 0 ? kinds[index - 1] : 0;
    if (kind === LESS && closesAsTypeArguments(text, kinds, bounds, index, count)) return false;
    if (kind === PAREN_L && mayBeArrowWithReturnType(kinds, closing, index, count)) return false;
    // The stripper accepts `declare`, `namespace` and `global` declarations
    // across a line break; JavaScript reads the keyword as an expression.
    if (kind === CONTEXTUAL && index + 1 < count && startsStatement(kinds, index, lineBreakBefore)) {
      const next = kinds[index + 1];
      if (next === NAME || next === CONTEXTUAL || next === ASYNC || next === WORD || next === EXTENDS
        || next === EXPRESSION_KEYWORD || next === RELATION_KEYWORD || next === STRING || next === BRACE_L) return false;
    }
    if (kind === BANG && index > 0 && lineBreakBefore(index) && endsExpression(previous)) return false;
  }
  return true;
}

// Tokens after which a line break may end a statement.
function endsExpression(kind) {
  return kind === NAME || kind === CONTEXTUAL || kind === ASYNC || kind === RELATION_KEYWORD || kind === EXPRESSION_KEYWORD
    || kind === WORD || kind === STATEMENT_KEYWORD || kind === STRING || kind === PAREN_R || kind === BRACKET_R
    || kind === BRACE_R || kind === INC_DEC;
}

// Where a declaration could begin: after a statement or block boundary, a
// keyword or label, or after a line break that may end the previous statement.
// `.type` and `a.b = type` are never declarations.
function startsStatement(kinds, index, lineBreakBefore) {
  if (index === 0) return true;
  const previous = kinds[index - 1];
  if (previous === SEMICOLON || previous === BRACE_L || previous === BRACE_R || previous === COLON
    || previous === PAREN_R || previous === STATEMENT_KEYWORD || previous === EXPRESSION_KEYWORD) return true;
  return lineBreakBefore(index) && endsExpression(previous);
}

// `cond ? (a): T => b` and `case (a): b => c` read as an arrow function with a
// return type: a ( that opens an expression, could start a parameter list,
// and closes right before a colon that JavaScript follows with an arrow
// function (`T => b`, or `(x) => y => b` for a function return type). A ( after
// a name, `this`, a literal or a closing bracket is a call.
function mayBeArrowWithReturnType(kinds, closing, index, count) {
  const close = closing[index];
  if (close === -1 || close + 2 >= count || kinds[close + 1] !== COLON) return false;
  const previous = index > 0 ? kinds[index - 1] : 0;
  if (previous === NAME || previous === EXPRESSION_KEYWORD || previous === PAREN_R || previous === BRACKET_R
    || previous === STRING || previous === RELATION_KEYWORD) return false;
  const first = kinds[index + 1];
  if (!(first === PAREN_R || first === NAME || first === CONTEXTUAL || first === ASYNC || first === RELATION_KEYWORD
    || first === EXPRESSION_KEYWORD || first === BRACKET_L || first === BRACE_L || first === TYPE_PUNCTUATION)) return false;
  const after = kinds[close + 2];
  if (after === NAME || after === CONTEXTUAL || after === ASYNC || after === RELATION_KEYWORD) return kinds[close + 3] === ARROW;
  if (after === PAREN_L) return closing[close + 2] !== -1 && kinds[closing[close + 2] + 1] === ARROW;
  return false;
}

function matchingParentheses(kinds, count) {
  const closing = new Int32Array(count).fill(-1);
  const open = [];
  for (let index = 0; index < count; index += 1) {
    if (kinds[index] === PAREN_L) open.push(index);
    else if (kinds[index] === PAREN_R && open.length) closing[open.pop()] = index;
  }
  return closing;
}

// Whether the tokens after a `<` could be read as a type argument list closed
// by a `>`: brackets stay balanced and every token can occur in a type. A `?`
// outside brackets needs a conditional type's `extends`. After `<<` the list
// would have to begin with a generic function type, `<T>(...) => R`: its type
// parameters end at a `>` followed by `(`.
function closesAsTypeArguments(text, kinds, bounds, start, count) {
  if (text.charCodeAt(bounds[start * 2] + 1) === 60 /* << */) {
    const end = Math.min(count, start + MAX_TYPE_ARGUMENT_TOKENS);
    let angles = 1;
    for (let index = start + 1; index < end; index += 1) {
      const kind = kinds[index];
      if (kind === LESS || kind === GREATER) {
        let size = 0;
        for (let at = bounds[index * 2]; at < bounds[index * 2 + 1]; at += 1) {
          const code = text.charCodeAt(at);
          if (code === 60 || code === 62) size += 1;
        }
        angles += kind === LESS ? size : -size;
        if (angles <= 0) return kinds[index + 1] === PAREN_L;
      } else if (kind === OTHER || kind === BANG || kind === SEMICOLON || kind === INC_DEC || kind === STATEMENT_KEYWORD) {
        return false;
      }
    }
    return end < count;
  }
  let depth = 0;
  let conditional = false;
  const end = Math.min(count, start + MAX_TYPE_ARGUMENT_TOKENS);
  for (let index = start + 1; index < end; index += 1) {
    const kind = kinds[index];
    if (kind === GREATER) {
      if (depth === 0) return true;
      continue;
    }
    if (kind === PAREN_L || kind === BRACKET_L || kind === BRACE_L) depth += 1;
    else if (kind === PAREN_R || kind === BRACKET_R || kind === BRACE_R) {
      depth -= 1;
      if (depth < 0) return false;
    } else if (kind === EXTENDS) {
      if (depth === 0) conditional = true;
    } else if (kind === QUESTION) {
      if (depth === 0 && !conditional) return false;
    } else if (kind === SEMICOLON) {
      if (depth === 0) return false;
    } else if (kind === OTHER || kind === BANG || kind === INC_DEC || kind === EQ || kind === STATEMENT_KEYWORD) {
      return false;
    }
  }
  // Too long to decide cheaply: refuse.
  return end < count;
}
