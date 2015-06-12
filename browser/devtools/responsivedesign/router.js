/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const promise = require("promise");
const { Task } = require("resource://gre/modules/Task.jsm");
const { ThreadStateTypes, UnsolicitedNotifications, UnsolicitedPauses } =
  require("resource://gre/modules/devtools/dbg-client.jsm");

let Router = exports.Router = function(owner) {
  this.owner = owner;
  this.onViewportAdded = this.onViewportAdded.bind(this);
  this.owner.on("viewport-added", this.onViewportAdded);
  this.routerViewports = [];
  this.owner.viewports.forEach(v => this.onViewportAdded(null, v));
};

Router.prototype = {

  destroy: Task.async(function*() {
    this.owner.off("viewport-added", this.onViewportAdded);
    yield this.stop();
    this.owner = null;
    this.routerViewports = null;
  }),

  onViewportAdded(_, viewport) {
    let routerViewport = new RouterViewport({
      router: this,
      viewport
    });
    this.routerViewports.push(routerViewport);
    if (this.active) {
      routerViewport.installProxy();
    }
  },

  start() {
    if (this.active) {
      return promise.resolve();
    }
    this.active = true;
    return promise.all(this.routerViewports.map(v => v.installProxy()));
  },

  stop() {
    if (!this.active) {
      return promise.resolve();
    }
    this.active = false;
    return promise.all(this.routerViewports.map(v => v.uninstallProxy()));
  },

};

let RouterViewport = function(options) {
  this.router = options.router;
  this.viewport = options.viewport;
};

RouterViewport.prototype = {

  get target() {
    return this.viewport.responsiveBrowser.viewportTarget.target;
  },

  get otherViewports() {
    return this.router.routerViewports.filter(v => v !== this);
  },

  installProxy: Task.async(function*() {
    if (this.proxy) {
      // Already installed
      return;
    }
    let target = yield this.target;
    let transport = target.client._transport;
    this.proxy = new TransportProxy(transport);
    target.client._transport = new Proxy(transport, this.proxy);
  }),

  uninstallProxy: Task.async(function*() {
    if (!this.proxy) {
      // Already uninstalled
      return;
    }
    let target = yield this.target;
    if (!target.client) {
      return;
    }
    this.proxy.destroy();
    target.client._transport = this.proxy.target;
    this.proxy = null;
  }),

};

/**
 * By proxying the DevTools transport, we can trace the communication pathways
 * that lead to the creation of each actor.
 *
 * By tracing pathways across multiple transports, we discover how to rewrite
 * the destination of a packet from one to connection into a match actor from a
 * different connection.
 */
function TransportProxy(target) {
  this.pendingRequests = new Map();
  this.completedRequests = [];
  this.target = target;
  this.hooks = this.target.hooks;
  this.target.hooks = new Proxy(this.hooks, this);
}

TransportProxy.prototype = {

  target: null,

  hooks: null,

  /**
   * Map of pending requests by destination actor.
   * Unlike dbg-client, protocol.js will allow multiple pending requests to the
   * same actor, as it relies on the server to correctly order replies.
   */
  pendingRequests: null,

  completedRequests: null,

  destroy() {
    this.target.hooks = this.hooks;
  },

  get(target, name) {
    if (this[name]) {
      return this[name];
    }
    return target[name];
  },

  send(packet) {
    let { to, oneway } = packet;
    // Handle one-way specially
    if (oneway) {
      this.completedRequests.push({
        request: packet,
        reply: { oneway }
      });
      // Send the one-way request
      this.target.send(packet);
      return;
    }
    // Track new pending request
    let requestsForActor = this.pendingRequests.get(to) || [];
    requestsForActor.push(packet);
    this.pendingRequests.set(to, requestsForActor);
    // Send the request
    this.target.send(packet);
  },

  onPacket(packet) {
    let { from } = packet;
    // Handle events specially
    if (this.isEvent(packet)) {
      this.completedRequests.push({
        request: { event: true },
        reply: packet
      });
      // Deliver the event
      this.hooks.onPacket(packet);
      return;
    }
    // Join the reply with its request
    let requestsForActor = this.pendingRequests.get(from);
    if (!requestsForActor || requestsForActor.length === 0) {
      throw new Error(`Unexpected packet from ${from},` +
                      ` ${JSON.stringify(packet)}`);

    }
    let request = requestsForActor.shift();
    if (requestsForActor.length === 0) {
      this.pendingRequests.delete(from);
    }
    this.completedRequests.push({
      request,
      reply: packet
    });
    // Deliver the reply
    this.hooks.onPacket(packet);
  },

  isEvent(packet) {
    let { event, type } = packet;
    return event ||
           type in UnsolicitedNotifications ||
           (type == ThreadStateTypes.paused &&
            packet.why.type in UnsolicitedPauses);
  },

};
