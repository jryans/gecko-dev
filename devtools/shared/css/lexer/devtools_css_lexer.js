var self = {};

                (function() {
                    var wasm;
                    const __exports = {};
                    
                    function init(wasm_path) {
                        return fetch(wasm_path)
                            .then(response => response.arrayBuffer())
                            .then(buffer => WebAssembly.instantiate(buffer, { './devtools_css_lexer': __exports }))
                            .then(({instance}) => {
                                wasm = init.wasm = instance.exports;
                                return;
                            });
                    };
                    self.wasm_bindgen = Object.assign(init, __exports);
                })();
            

self.wasm_bindgen.loaded = self.wasm_bindgen("resource://devtools/shared/css/lexer/devtools_css_lexer_bg.wasm");
module.exports = self.wasm_bindgen;
