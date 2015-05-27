/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const protocol = require("devtools/server/protocol");
const { method, Arg, RetVal } = protocol;
const { DebuggerServer } = require("devtools/server/main");
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

  get layoutHelpers() {
    if (this._layoutHelpers) {
      return this._layoutHelpers;
    }
    this._layoutHelpers = new LayoutHelpers(this._window);
    return this._layoutHelpers;
  },

  dispatch: method(function(eventSpec) {
    // TODO: Clamp other positions to offsetX/Y somewhere
    let x = eventSpec.offsetX;
    let y = eventSpec.offsetY;
    let element = this.layoutHelpers.getElementFromPoint(this.document, x, y);
    if (!element) {
      return;
    }
    let elementWindow = element.ownerDocument.defaultView;
    let MouseEvent = elementWindow.MouseEvent;
    let event = new MouseEvent(eventSpec.type, eventSpec);
    element.dispatchEvent(event);
  }, {
    request: { eventSpec: Arg(0, "json") },
    oneway: true
  }),

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
  }),

});
