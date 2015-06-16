/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* globals events, CssLogic */

"use strict";

const { Ci } = require("chrome");
const protocol = require("devtools/server/protocol");
const { method, Arg } = protocol;
loader.lazyRequireGetter(this, "events", "sdk/event/core");
loader.lazyRequireGetter(this, "CssLogic",
                         "devtools/styleinspector/css-logic", true);

let SyncActor = exports.SyncActor = protocol.ActorClass({

  typeName: "sync",

  get events() {
    let events = {};
    for (let type in this.listenFor) {
      events[type] = {
        event: Arg(0, "json")
      };
    }
    return events;
  },

  initialize(conn, tab) {
    protocol.Actor.prototype.initialize.call(this, conn);
    this.tab = tab;
    this.onScroll = this.onScroll.bind(this);
    this.onEventOverheard = this.onEventOverheard.bind(this);
  },

  disconnect() {
    this.destroy();
  },

  destroy() {
    this.unlisten();
    this.tab = null;
  },

  get window() {
    return this.tab.window;
  },

  get document() {
    return this.window.document;
  },

  listenFor: {
    "scroll": "onScroll"
  },

  dispatchFor: {
    "navigate": "navigate",
    "scroll": "scroll",
  },

  listen: method(function() {
    if (this._listening) {
      return;
    }
    this._listening = true;
    for (let type in this.listenFor) {
      let handler = this[this.listenFor[type]];
      this.window.addEventListener(type, handler, true);
    }
    // If the page navigates, we need to rebind our listeners
    events.once(this.tab, "will-navigate", () => this.unlisten());
    events.once(this.tab, "navigate", () => this.listen());
  }),

  unlisten: method(function() {
    if (!this._listening) {
      return;
    }
    for (let type in this.listenFor) {
      let handler = this[this.listenFor[type]];
      this.window.removeEventListener(type, handler, true);
    }
    this._listening = false;
  }),

  dispatch: method(function(eventSpec) {
    // Some events should be dispatched via internal methods to ensure they act
    // like real user input.
    let dispatch = this.dispatchFor[eventSpec.type];
    if (this[dispatch]) {
      this[dispatch](eventSpec);
      return;
    }
    throw new Error(`No dispatch method for type ${eventSpec.type}`);
  }, {
    request: { eventSpec: Arg(0, "json") },
    oneway: true
  }),

  // TODO: Probably belongs on TabActor
  navigate: method(function(url) {
    this.window.location = url;
  }, {
    request: { url: Arg(0, "string") },
    oneway: true
  }),

  onScroll(event) {
    let element = event.target;
    if (event.target instanceof Ci.nsIDOMHTMLDocument) {
      element = event.target.documentElement;
    }
    event.targetSelector = CssLogic.findCssSelector(element);
    event.scrollLeft = element.scrollLeft;
    event.scrollTop = element.scrollTop;
    this.onEventOverheard(event);
  },

  scroll(eventSpec) {
    let selector = eventSpec.targetSelector;
    let target = this.document.querySelector(selector);
    if (!target) {
      throw new Error(`Could not find element for selector ${selector}`);
    }
    target.scrollLeft = eventSpec.scrollLeft;
    target.scrollTop = eventSpec.scrollTop;
  },

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
    events.emit(this, event.type, eventSpec);
  },

});

exports.SyncFront = protocol.FrontClass(SyncActor, {

  initialize: function(client, form) {
    protocol.Front.prototype.initialize.call(this, client);
    this.actorID = form.syncActor;
    this.manage(this);
  },

  send(packet) {
    packet._routerIgnore = true;
    protocol.Front.prototype.send.call(this, packet);
  },

});
