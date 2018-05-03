```
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/devtools_css_lexer.wasm --out-dir . --no-modules --no-typescript
```

Adjust devtools_css_lexer.js for DevTools loader:

```
printf '%s\n%s\n%s' 'var self = {};' "$(cat devtools_css_lexer.js)" '
self.wasm_bindgen.loaded = self.wasm_bindgen("resource://devtools/shared/css/lexer/devtools_css_lexer_bg.wasm");
module.exports = self.wasm_bindgen;
' > devtools_css_lexer.js
```
