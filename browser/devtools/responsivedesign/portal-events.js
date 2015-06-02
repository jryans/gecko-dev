/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

loader.lazyRequireGetter(this, "EventFront",
                         "devtools/server/actors/event", true);

/**
 * Tunnel various UI events from a given container via the RDP to another
 * device.
 * @param options
 *        {
 *          element: Element to listen for events from
 *          client: RDP client
 *          form: global / tab actor form
 *        }
 */
let PortalEvents = exports.PortalEvents = function(options) {
  this.element = options.element;
  this.client = options.client;
  this.form = options.form;
};

PortalEvents.prototype = {

  events: [
    "blur",
    "click",
    "dblclick",
    "focus",
    "keydown",
    "keypress",
    "keyup",
    "mousedown",
    "mouseenter",
    "mouseleave",
    "mousemove",
    "mouseout",
    "mouseover",
    "mouseup",
    "wheel",
  ],

  get event() {
    if (this._event) {
      return this._event;
    }
    this._event = new EventFront(this.client, this.form);
    return this._event;
  },

  init() {
    this.events.forEach(type => {
      this.element.addEventListener(type, this, true);
    });
  },

  destroy() {
    this.events.forEach(type => {
      this.element.removeEventListener(type, this, true);
    });
  },

  handleEvent(event) {
    this.event.dispatch(event);
    event.stopPropagation();
  },

};
