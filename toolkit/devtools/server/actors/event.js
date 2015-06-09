/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* globals LayoutHelpers, eventUtils */

"use strict";

const { Ci } = require("chrome");
const Services = require("Services");
const protocol = require("devtools/server/protocol");
const { method, Arg } = protocol;
const { DebuggerServer } = require("devtools/server/main");
loader.lazyImporter(this, "LayoutHelpers",
                    "resource://gre/modules/devtools/LayoutHelpers.jsm");
loader.lazyRequireGetter(this, "eventUtils",
                         "devtools/server/actors/utils/event");

let EventActor = exports.EventActor = protocol.ActorClass({

  typeName: "event",

  initialize(conn) {
    protocol.Actor.prototype.initialize.call(this, conn);
    let windowType = DebuggerServer.chromeWindowType;
    this.window = Services.wm.getMostRecentWindow(windowType);
  },

  disconnect() {
    this.destroy();
  },

  destroy() {
    this.window = null;
  },

  get document() {
    return this.window.document;
  },

  get outerWindow() {
    let outerWindowID = this.window.QueryInterface(Ci.nsIInterfaceRequestor)
                            .getInterface(Ci.nsIDOMWindowUtils).outerWindowID;
    return Services.wm.getOuterWindowWithId(outerWindowID);
  },

  get utils() {
    return this.window.QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIDOMWindowUtils);
  },

  get layoutHelpers() {
    if (this._layoutHelpers) {
      return this._layoutHelpers;
    }
    this._layoutHelpers = new LayoutHelpers(this.window);
    return this._layoutHelpers;
  },

  dispatchFor: {
    "blur": { type: "Focus", method: "setActiveWindow" },
    "click": { type: "Mouse" },
    "dblclick": { type: "Mouse" },
    "contextmenu": { type: "Mouse", method: "sendMouseEvent" },
    "focus": { type: "Focus", method: "setActiveWindow" },
    "keydown": { type: "Keyboard", method: "sendKeyEvent" },
    "keypress": { type: "Keyboard", method: "sendKeyEvent" },
    "keyup": { type: "Keyboard", method: "sendKeyEvent" },
    "mousedown": { type: "Mouse", method: "sendMouseEvent" },
    "mouseenter": { type: "Mouse" },
    "mouseleave": { type: "Mouse" },
    "mousemove": { type: "Mouse", method: "sendMouseEvent" },
    "mouseout": { type: "Mouse", method: "sendMouseEvent" },
    "mouseover": { type: "Mouse", method: "sendMouseEvent" },
    "mouseup": { type: "Mouse", method: "sendMouseEvent" },
    "MozMouseHittest": { type: "Mouse", method: "sendMouseEvent" },
    "wheel": { type: "Wheel", method: "sendWheelEvent" },
  },

  dispatch: method(function(eventSpec) {
    // Some events should be dispatched via internal methods to ensure they act
    // like real user input.
    let dispatch = this.dispatchFor[eventSpec.type];
    if (this[dispatch.method]) {
      this[dispatch.method](eventSpec);
      return;
    }
    let element = this.getTargetElement(eventSpec);
    if (!element) {
      let desc = `type: ${eventSpec.type}, x: ${eventSpec.offsetX}, ` +
                 `y: ${eventSpec.offsetY}`;
      throw new Error(`Dispatch failed, no target element found:\n${desc}`);
    }
    let elementWindow = element.ownerDocument.defaultView;
    let constuctorType = `${dispatch.type}Event`;
    let Event = elementWindow[constuctorType];
    let event = new Event(eventSpec.type, eventSpec);
    element.dispatchEvent(event);
  }, {
    request: { eventSpec: Arg(0, "json") },
    oneway: true
  }),

  getTargetElement(eventSpec) {
    // TODO: Clamp other positions to offsetX/Y somewhere
    let x = eventSpec.offsetX;
    let y = eventSpec.offsetY;
    return this.layoutHelpers.getElementFromPoint(this.document, x, y);
  },

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
    eventUtils.sendWheelEvent(this.utils, eventSpec);
  },

  setActiveWindow(eventSpec) {
    if (eventSpec.type == "focus") {
      Services.focus.windowRaised(this.outerWindow);
    } else {
      Services.focus.windowLowered(this.outerWindow);
    }
  },

  _parseModifiers(eventSpec) {
    return eventUtils.parseModifiers(this.utils, eventSpec);
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
