#![feature(proc_macro, wasm_custom_section, wasm_import_module)]

extern crate cssparser;
extern crate wasm_bindgen;

use cssparser::{Parser, ParserInput};
use wasm_bindgen::prelude::*;

// pub struct CSSLexer<'a> {
//   input: ParserInput<'a>,
//   // parser: Parser,
// }

static mut TEXT: Option<String> = None;
static mut INPUT: Option<ParserInput> = None;
static mut PARSER: Option<Parser> = None;

#[wasm_bindgen]
pub fn new_lexer(text: &str) {
  unsafe {
    TEXT = Some(String::from(text));
    INPUT = Some(ParserInput::new(TEXT.as_ref().unwrap()));
    PARSER = Some(Parser::new(INPUT.as_mut().unwrap()));
  }
}

#[wasm_bindgen]
pub fn next_token() -> String {
  let parser = unsafe { PARSER.as_mut().unwrap() };
  format!("{:?}", parser.next().ok())
}

// impl<'a> CSSLexer<'a> {
//   // #[wasm_bindgen]
//   pub fn new(input: &'a mut ParserInput<'a>) -> Self {
//     CSSLexer {
//       parser: Parser::new(input),
//     }
//   }

//   pub fn get_line_number(&self) -> u32 {
//     0
//   }

//   pub fn get_column_number(&self) -> u32 {
//     0
//   }
// }