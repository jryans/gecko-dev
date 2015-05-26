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

  click: method(function(x, y) {
    let element = this.layoutHelpers.getElementFromPoint(this.document, x, y);
    let elementWindow = element.ownerDocument.defaultView;
    let MouseEvent = elementWindow.MouseEvent;
    let event = new MouseEvent("click", { bubbles: true, cancelable: true });
    dump(`${element.toString()}: ${element.localName}\n`)
    element.dispatchEvent(event);
  }, {
    request: { x: Arg(0, "number"), y: Arg(1, "number") },
    oneway: true
  }),

});

exports.EventFront = protocol.FrontClass(EventActor, {
  initialize: function(client, form) {
    protocol.Front.prototype.initialize.call(this, client);
    this.actorID = form.eventActor;
    this.manage(this);
  },
});
