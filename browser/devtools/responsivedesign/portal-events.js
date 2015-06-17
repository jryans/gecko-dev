/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Tunnel various UI events from a given container via the RDP to another
 * device.
 * @param options
 *        {
 *          element: Element to listen for events from
 *          event: EventFront
 *        }
 */
let PortalEvents = exports.PortalEvents = function(options) {
  this.element = options.element;
  this.event = options.event;
};

PortalEvents.prototype = {

  events: [
    "blur",
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
    // Stop backspace from navigating browser back
    if (event.type == "keypress" && event.key == "Backspace") {
      event.preventDefault();
    }
    event.stopPropagation();
  },

};
