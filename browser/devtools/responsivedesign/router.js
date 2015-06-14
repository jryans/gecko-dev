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
    target.client._transport = this.proxy.transport;
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
function TransportProxy(transport) {
  this.pendingRequests = new Map();
  this.completedExchanges = [];
  this.countersByType = new Map();
  this.actorAnnouncements = new Map();
  this.send = this.send.bind(this);
  this.onPacket = this.onPacket.bind(this);
  this.transport = transport;
  this.hooks = this.transport.hooks;
  // TODO: Switch to events from the transport?
  this.transport.hooks = new Proxy(this.hooks, this);
}

TransportProxy.prototype = {

  transport: null,

  hooks: null,

  /**
   * Map of pending requests by destination actor.
   * Unlike dbg-client, protocol.js will allow multiple pending requests to the
   * same actor, as it relies on the server to correctly order replies.
   */
  pendingRequests: null,

  completedExchanges: null,

  /**
   * Map of packet counters per [actor, type] tuple.
   * Allows assigning unique IDs to each exchange.
   */
  countersByType: null,

  /**
   * Map of actor IDs to an object containing data about the actor's original
   * announcement:
   * {
   *   exchangeID,
   *   keyPath
   * }
   */
  actorAnnouncements: null,

  destroy() {
    this.transport.hooks = this.hooks;
  },

  get(target, name) {
    if (this[name]) {
      return this[name];
    }
    return target[name];
  },

  send(packet) {
    let { to, _oneway: oneway } = packet;
    // Handle one-way specially
    if (oneway) {
      this.inspectCompletedExchange({
        request: packet,
        reply: { oneway }
      });
      // Send the one-way request
      this.transport.send(packet);
      return;
    }
    // Track new pending request
    let requestsForActor = this.pendingRequests.get(to) || [];
    requestsForActor.push(packet);
    this.pendingRequests.set(to, requestsForActor);
    // Send the request
    this.transport.send(packet);
  },

  onPacket(packet) {
    let { from } = packet;
    // Handle events specially
    if (this.isEvent(packet)) {
      this.inspectCompletedExchange({
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
    this.inspectCompletedExchange({
      request,
      reply: packet
    });
    // Deliver the reply
    this.hooks.onPacket(packet);
  },

  isEvent(packet) {
    let { _event, type } = packet;
    return _event ||
           type in UnsolicitedNotifications ||
           (type == ThreadStateTypes.paused &&
            packet.why.type in UnsolicitedPauses);
  },

  inspectCompletedExchange(exchange) {
    let id = this.createExchangeID(exchange);

    if (!id) {
      // Expected only for one-way requests, all others should continue
      // One-way requests can't announce actors, so we're done
      this.completedExchanges.push(exchange);
      return;
    }

    Object.assign(exchange, id);

    // Record any new actor announcements
    this.findActorPairs(exchange.reply).forEach(([ keyPath, actorID ]) => {
      this.actorAnnouncements.set(actorID, {
        exchangeID: id,
        keyPath
      });
    });

    this.completedExchanges.push(exchange);
  },

  createExchangeID({ request, reply }) {
    let { from } = reply;
    let type = request.type || reply.type;
    if (!from || !type) {
      // Expected only for one-way requests, all others should continue
      return null;
    }
    let actorType = `${from}.${type}`;
    let counter = this.countersByType.get(actorType) || 0;
    let id = {
      actor: from,
      type,
      counter
    };
    this.countersByType.set(actorType, ++counter);
    return id;
  },

  findActorPairs(reply) {
    return pairs(reply).filter(pair => this.isActor(pair));
  },

  isActor([ keyPath ]) {
    let last = keyPath[keyPath.length - 1];
    return last == "actor" || last.endsWith("Actor");
  },

};

/**
 * Collect an array of key, value tuples for each item in an object.
 *
 * Nested arrays and objects are also visited.
 * Keys are expressed as an array of path segments.
 */
function pairs(object) {
  let result = [];
  for (let key in object) {
    let value = object[key];
    if (typeof value == "object") {
      pairs(value).forEach(pair => {
        pair[0].unshift(key);
        result.push(pair);
      });
    } else {
      result.push([ [ key ], value ]);
    }
  }
  return result;
}
