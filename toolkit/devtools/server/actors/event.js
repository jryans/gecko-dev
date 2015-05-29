/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Ci } = require("chrome");
const protocol = require("devtools/server/protocol");
const { method, Arg } = protocol;
const { DebuggerServer } = require("devtools/server/main");
const Runtime = require("sdk/system/runtime");
loader.lazyImporter(this, "LayoutHelpers",
                    "resource://gre/modules/devtools/LayoutHelpers.jsm");

let EventActor = exports.EventActor = protocol.ActorClass({

  typeName: "event",

  initialize(conn) {
    protocol.Actor.prototype.initialize.call(this, conn);
    let windowType = DebuggerServer.chromeWindowType;
    this._window = Services.wm.getMostRecentWindow(windowType);
  },

  disconnect() {
    this.destroy();
  },

  destroy() {
    this._window = null;
  },

  get document() {
    return this._window.document;
  },

  get utils() {
    return this._window.QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIDOMWindowUtils);
  },

  get layoutHelpers() {
    if (this._layoutHelpers) {
      return this._layoutHelpers;
    }
    this._layoutHelpers = new LayoutHelpers(this._window);
    return this._layoutHelpers;
  },

  eventRouting: {
    "click": { type: "Mouse" },
    "dblclick": { type: "Mouse" },
    "contextmenu": { type: "Mouse", dispatch: "sendMouseEvent" },
    "keydown": { type: "Keyboard", dispatch: "sendKeyEvent" },
    "keypress": { type: "Keyboard", dispatch: "sendKeyEvent" },
    "keyup": { type: "Keyboard", dispatch: "sendKeyEvent" },
    "mousedown": { type: "Mouse", dispatch: "sendMouseEvent" },
    "mouseenter": { type: "Mouse" },
    "mouseleave": { type: "Mouse" },
    "mousemove": { type: "Mouse", dispatch: "sendMouseEvent" },
    "mouseout": { type: "Mouse", dispatch: "sendMouseEvent" },
    "mouseover": { type: "Mouse", dispatch: "sendMouseEvent" },
    "mouseup": { type: "Mouse", dispatch: "sendMouseEvent" },
    "MozMouseHittest": { type: "Mouse", dispatch: "sendMouseEvent" },
    "wheel": { type: "Wheel", dispatch: "sendWheelEvent" },
  },

  dispatch: method(function(eventSpec) {
    // Some events should be dispatched via internal methods to ensure they act
    // like real user input.
    let routing = this.eventRouting[eventSpec.type];
    let dispatch = routing.dispatch;
    if (dispatch) {
      this[dispatch](eventSpec);
      return;
    }
    // TODO: Clamp other positions to offsetX/Y somewhere
    let x = eventSpec.offsetX;
    let y = eventSpec.offsetY;
    let element = this.layoutHelpers.getElementFromPoint(this.document, x, y);
    if (!element) {
      return;
    }
    let elementWindow = element.ownerDocument.defaultView;
    let constuctorType = `${routing.type}Event`;
    let Event = elementWindow[constuctorType];
    let event = new Event(eventSpec.type, eventSpec);
    element.dispatchEvent(event);
  }, {
    request: { eventSpec: Arg(0, "json") },
    oneway: true
  }),

  sendKeyEvent(eventSpec) {
    let modifiers = this._parseModifiers(eventSpec);
    this.utils.sendKeyEvent(eventSpec.type, eventSpec.keyCode,
                            eventSpec.charCode, modifiers,
                            this.utils.KEY_FLAG_NOT_SYNTHESIZED_FOR_TESTS);
  },

  sendMouseEvent(eventSpec) {
    // TODO: Clamp other positions to offsetX/Y somewhere
    let x = eventSpec.offsetX;
    let y = eventSpec.offsetY;
    let clickCount = 0;
    if (eventSpec.type == "mousedown" || eventSpec.type == "mouseup") {
      clickCount = 1;
    }
    let modifiers = this._parseModifiers(eventSpec);
    let pressure = eventSpec.pressure || eventSpec.mozPressure || 0;
    let inputSource = eventSpec.inputSource || eventSpec.mozInputSource || 0;
    this.utils.sendMouseEvent(eventSpec.type, x, y, eventSpec.button,
                              clickCount, modifiers, false, pressure,
                              inputSource, eventSpec.isSynthesized);
  },

  sendWheelEvent(eventSpec) {
    // TODO: Clamp other positions to offsetX/Y somewhere
    let x = eventSpec.offsetX;
    let y = eventSpec.offsetY;
    let modifiers = this._parseModifiers(eventSpec);
    this.utils.sendWheelEvent(x, y, eventSpec.deltaX, eventSpec.deltaY,
                              eventSpec.deltaZ, eventSpec.deltaMode, modifiers,
                              0 /* aLineOrPageDeltaX */,
                              0 /* aLineOrPageDeltaY */, 0 /* aOptions */);
  },

  _parseModifiers(eventSpec) {
    let mval = 0;
    if (eventSpec.shiftKey) {
      mval |= this.utils.MODIFIER_SHIFT;
    }
    if (eventSpec.ctrlKey) {
      mval |= this.utils.MODIFIER_CONTROL;
    }
    if (eventSpec.altKey) {
      mval |= this.utils.MODIFIER_ALT;
    }
    if (eventSpec.metaKey) {
      mval |= this.utils.MODIFIER_META;
    }
    if (eventSpec.accelKey) {
      mval |= (Runtime.OS == "Darwin") ?
        this.utils.MODIFIER_META : this.utils.MODIFIER_CONTROL;
    }
    if (eventSpec.altGrKey) {
      mval |= this.utils.MODIFIER_ALTGRAPH;
    }
    if (eventSpec.capsLockKey) {
      mval |= this.utils.MODIFIER_CAPSLOCK;
    }
    if (eventSpec.fnKey) {
      mval |= this.utils.MODIFIER_FN;
    }
    if (eventSpec.fnLockKey) {
      mval |= this.utils.MODIFIER_FNLOCK;
    }
    if (eventSpec.numLockKey) {
      mval |= this.utils.MODIFIER_NUMLOCK;
    }
    if (eventSpec.scrollLockKey) {
      mval |= this.utils.MODIFIER_SCROLLLOCK;
    }
    if (eventSpec.symbolKey) {
      mval |= this.utils.MODIFIER_SYMBOL;
    }
    if (eventSpec.symbolLockKey) {
      mval |= this.utils.MODIFIER_SYMBOLLOCK;
    }
    if (eventSpec.osKey) {
      mval |= this.utils.MODIFIER_OS;
    }
    return mval;
  },

});

exports.EventFront = protocol.FrontClass(EventActor, {

  initialize: function(client, form) {
    protocol.Front.prototype.initialize.call(this, client);
    this.actorID = form.eventActor;
    this.manage(this);
  },

  dispatch: protocol.custom(function(event) {
    let eventSpec = {};
    for (let key in event) {
      if (key[0] !== key[0].toLowerCase()) {
        // Keys starting with an upper letter are consts
        continue;
      }
      let value = event[key];
      if (typeof value !== "boolean" &&
          typeof value !== "number" &&
          typeof value !== "string") {
        // Primitives only
        continue;
      }
      eventSpec[key] = value;
    }
    return this._dispatch(eventSpec);
  }, {
    impl: "_dispatch"
  })

});
