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

  get viewportTarget() {
    return this.viewport.responsiveBrowser.viewportTarget;
  },

  get target() {
    return this.viewportTarget.target;
  },

  get otherViewports() {
    return this.router.routerViewports.filter(v => v !== this);
  },

  installProxy: Task.async(function*() {
    if (this.proxy) {
      // Already installed
      return;
    }
    yield this.viewportTarget.formSelected;
    let target = yield this.target;
    let transport = target.client._transport;
    this.proxy = new TransportProxy(transport, target.form);
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
function TransportProxy(transport, rootForm) {
  this.pendingRequests = new Map();
  this.completedExchanges = [];
  this.completedExchangesByKey = new Map();
  this.countersByType = new Map();
  this.actorAnnouncements = new Map();
  this.actorPaths = new Map();
  this.send = this.send.bind(this);
  this.onPacket = this.onPacket.bind(this);
  this.transport = transport;
  this.hooks = this.transport.hooks;
  // TODO: Switch to events from the transport?
  this.transport.hooks = new Proxy(this.hooks, this);
  this.bootstrap(rootForm);
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
   * Map of completed exchanges by exchange key.
   * TODO: Reduce to actor exchanges only?
   */
  completedExchangesByKey: null,

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

  /**
   * Map of actor IDs to an array of path steps needed to find the same value:
   * [
   *   {
   *     exchangeID,
   *     keyPath
   *   },
   *   ...
   * ]
   */
  actorPaths: null,

  destroy() {
    this.transport.hooks = this.hooks;
  },

  get(target, name) {
    if (this[name]) {
      return this[name];
    }
    return target[name];
  },

  /**
   * Since the router can be enabled after the target's main form was retrieved
   * over the transport, we bootstrap our actor knowledge here by manually
   * adding the root form.  This ensures we know the path to all the top level
   * actors the target offers.
   */
  bootstrap(rootForm) {
    this.inspectCompletedExchange(new Exchange({
      request: { bootstrap: true },
      reply: Object.assign({
        from: "root",
        type: "bootstrap",
      }, rootForm)
    }, this));
  },

  send(packet) {
    let { to, _oneway: oneway } = packet;
    // Handle one-way specially
    if (oneway) {
      this.inspectCompletedExchange(new Exchange({
        request: packet,
        reply: { oneway }
      }, this));
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
      this.inspectCompletedExchange(new Exchange({
        request: { event: true },
        reply: packet
      }, this));
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
    this.inspectCompletedExchange(new Exchange({
      request,
      reply: packet
    }, this));
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
    let { id, reply } = exchange;

    if (!id) {
      // Expected only for one-way requests, all others should continue
      // One-way requests can't announce actors, so we're done
      this.completedExchanges.push(exchange);
      return;
    }

    // Record any new actor announcements
    this.findActorAnnouncements(reply).forEach(([ keyPath, actorID ]) => {
      this.actorAnnouncements.set(actorID, {
        exchangeID: id,
        keyPath
      });
    });

    this.completedExchanges.push(exchange);
    this.completedExchangesByKey.set(exchange.key, exchange);
  },

  findActorAnnouncements(reply) {
    return pairs(reply).filter(pair => this.isActor(pair));
  },

  isActor([ keyPath ]) {
    let last = keyPath[keyPath.length - 1];
    return last == "actor" || last.endsWith("Actor");
  },

  getActorPath(actor) {
    if (this.actorPaths.has(actor)) {
      return this.actorPaths.get(actor);
    }

    // Compute the full path by working back towards the root
    // TODO: Look up intermediate paths to save time
    let actorPath = [];
    let currentActor = actor;
    while (currentActor !== "root") {
      let announcement = this.actorAnnouncements.get(currentActor);
      if (!announcement) {
        throw new Error(`No actor announcement for ${currentActor}`);
      }
      actorPath.unshift(announcement);
      currentActor = announcement.exchangeID.actor;
    }

    this.actorPaths.set(actor, actorPath);
    return actorPath;
  },

  findActor(actorPath) {
    let actor = "root";
    for (let { exchangeID, keyPath } of actorPath) {
      let { type, counter } = exchangeID;
      // Look up the exchange, but using *our* actor instead
      let exchangeKey = Exchange.keyFromID({
        actor,
        type,
        counter,
      });
      let exchange = this.completedExchangesByKey.get(exchangeKey);
      if (!exchange) {
        throw new Error(`No exchange for ${exchangeKey}`);
      }
      let { reply } = exchange;
      actor = keyPath.reduce((object, key) => object[key], reply);
    }
    return actor;
  },

};

function Exchange({ request, reply }, proxy) {
  this.request = request;
  this.reply = reply;
  this.proxy = proxy;
  this.createID();
}

Exchange.keyFromID = function({ actor, type, counter }) {
  return `${actor}.${type}[${counter}]`;
};

Exchange.prototype = {

  request: null,

  reply: null,

  proxy: null,

  createID() {
    let { from } = this.reply;
    let type = this.request.type || this.reply.type;
    if (!from || !type) {
      // Expected only for one-way requests, all others should continue
      return;
    }
    let actorType = `${from}.${type}`;
    let counter = this.proxy.countersByType.get(actorType) || 0;
    Object.assign(this, {
      actor: from,
      type,
      counter
    });
    this.proxy.countersByType.set(actorType, ++counter);
  },

  get key() {
    if (!this.actor) {
      // Expected only for one-way requests, all others should continue
      return null;
    }
    return Exchange.keyFromID(this);
  },

  get id() {
    if (!this.actor) {
      // Expected only for one-way requests, all others should continue
      return null;
    }
    return {
      actor: this.actor,
      type: this.type,
      counter: this.counter,
    };
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
