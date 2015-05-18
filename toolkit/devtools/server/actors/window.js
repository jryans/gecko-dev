/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Ci, Cu } = require("chrome");
const protocol = require("devtools/server/protocol");
const { method, Arg, RetVal } = protocol;
const { DebuggerServer } = require("devtools/server/main");
const promise = require("promise");
const DevToolsUtils = require("devtools/toolkit/DevToolsUtils");

let WindowActor = exports.WindowActor = protocol.ActorClass({
  typeName: "window",

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

  get surfaceID() {
    return this._window.QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIDOMWindowUtils)
                       .getCompositorSurfaceID();
  },

  size: method(function() {
    return {
      width: this._window.outerWidth,
      height: this._window.outerHeight,
      devicePixelRatio: this._window.devicePixelRatio,
      surface: this.surfaceID
    }
  }, {
    response: RetVal("json")
  }),

  resize: method(function(width, height) {
    if (width === this._window.outerWidth &&
        height === this._window.outerHeight) {
      return {
        width: this._window.outerWidth,
        height: this._window.outerHeight,
        devicePixelRatio: this._window.devicePixelRatio,
        surface: this.surfaceID
      }
    }
    let deferred = promise.defer();
    let onResize = () => {
      this._window.removeEventListener("resize", onResize);
      // New surface not available until next tick
      // TODO: Maybe an async surface call is better?
      DevToolsUtils.executeSoon(() => {
        deferred.resolve({
          width: this._window.outerWidth,
          height: this._window.outerHeight,
          devicePixelRatio: this._window.devicePixelRatio,
          surface: this.surfaceID
        });
      });
    };
    this._window.addEventListener("resize", onResize);
    this._window.resizeTo(width, height);
    return deferred.promise;
  }, {
    request: { width: Arg(0, "number"), height: Arg(1, "number") },
    response: RetVal("json")
  })
});
