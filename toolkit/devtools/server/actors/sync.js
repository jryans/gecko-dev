/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* globals events */

"use strict";

const protocol = require("devtools/server/protocol");
const { method, Arg } = protocol;
loader.lazyRequireGetter(this, "events", "sdk/event/core");

let SyncActor = exports.SyncActor = protocol.ActorClass({

  typeName: "sync",

  events: {
    "overheard": {
      event: Arg(0, "json")
    }
  },

  initialize(conn, tab) {
    protocol.Actor.prototype.initialize.call(this, conn);
    this.tab = tab;
    this.onEventOverheard = this.onEventOverheard.bind(this);
  },

  disconnect() {
    this.destroy();
  },

  destroy() {
    if (this._listening) {
      this.unlisten();
    }
    this.tab = null;
  },

  get window() {
    return this.tab.window;
  },

  get document() {
    return this.window.document;
  },

  eventListening: {
    "scroll": {}
  },

  listen: method(function() {
    this._listening = true;
    for (let name in this.eventListening) {
      this.window.addEventListener(name, this.onEventOverheard, true);
    }
  }, {
    oneway: true
  }),

  unlisten: method(function() {
    for (let name in this.eventListening) {
      this.window.removeEventListener(name, this.onEventOverheard, true);
    }
    this._listening = false;
  }, {
    oneway: true
  }),

  onEventOverheard(event) {
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
    events.emit(this, "overheard", eventSpec);
  },

});

exports.SyncFront = protocol.FrontClass(SyncActor, {

  initialize: function(client, form) {
    protocol.Front.prototype.initialize.call(this, client);
    this.actorID = form.syncActor;
    this.manage(this);
  },

});
