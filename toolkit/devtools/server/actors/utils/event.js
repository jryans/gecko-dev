/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* globals Runtime */

"use strict";

loader.lazyRequireGetter(this, "Runtime", "sdk/system/runtime");

let parseModifiers = exports.parseModifiers = function(utils, eventSpec) {
  let mval = 0;
  if (eventSpec.shiftKey) {
    mval |= utils.MODIFIER_SHIFT;
  }
  if (eventSpec.ctrlKey) {
    mval |= utils.MODIFIER_CONTROL;
  }
  if (eventSpec.altKey) {
    mval |= utils.MODIFIER_ALT;
  }
  if (eventSpec.metaKey) {
    mval |= utils.MODIFIER_META;
  }
  if (eventSpec.accelKey) {
    mval |= (Runtime.OS == "Darwin") ?
      utils.MODIFIER_META : utils.MODIFIER_CONTROL;
  }
  if (eventSpec.altGrKey) {
    mval |= utils.MODIFIER_ALTGRAPH;
  }
  if (eventSpec.capsLockKey) {
    mval |= utils.MODIFIER_CAPSLOCK;
  }
  if (eventSpec.fnKey) {
    mval |= utils.MODIFIER_FN;
  }
  if (eventSpec.fnLockKey) {
    mval |= utils.MODIFIER_FNLOCK;
  }
  if (eventSpec.numLockKey) {
    mval |= utils.MODIFIER_NUMLOCK;
  }
  if (eventSpec.scrollLockKey) {
    mval |= utils.MODIFIER_SCROLLLOCK;
  }
  if (eventSpec.symbolKey) {
    mval |= utils.MODIFIER_SYMBOL;
  }
  if (eventSpec.symbolLockKey) {
    mval |= utils.MODIFIER_SYMBOLLOCK;
  }
  if (eventSpec.osKey) {
    mval |= utils.MODIFIER_OS;
  }
  return mval;
};

exports.sendMouseEvent = function(utils, eventSpec) {
  // TODO: Clamp other positions to offsetX/Y somewhere
  let x = eventSpec.offsetX;
  let y = eventSpec.offsetY;
  let clickCount = 0;
  if (eventSpec.type == "mousedown" || eventSpec.type == "mouseup") {
    clickCount = 1;
  }
  let modifiers = parseModifiers(utils, eventSpec);
  let pressure = eventSpec.pressure || eventSpec.mozPressure || 0;
  let inputSource = eventSpec.inputSource || eventSpec.mozInputSource || 0;
  utils.sendMouseEvent(eventSpec.type, x, y, eventSpec.button,
                       clickCount, modifiers, false, pressure,
                       inputSource, eventSpec.isSynthesized);
};

exports.sendWheelEvent = function(utils, eventSpec) {
  // TODO: Clamp other positions to offsetX/Y somewhere
  let x = eventSpec.offsetX;
  let y = eventSpec.offsetY;
  let modifiers = parseModifiers(utils, eventSpec);
  utils.sendWheelEvent(x, y, eventSpec.deltaX, eventSpec.deltaY,
                       eventSpec.deltaZ, eventSpec.deltaMode, modifiers,
                       0 /* aLineOrPageDeltaX */,
                       0 /* aLineOrPageDeltaY */, 0 /* aOptions */);
};
