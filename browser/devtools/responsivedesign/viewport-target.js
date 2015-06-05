/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let { Cu } = require("chrome");
let { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
let { ConnectionManager, Connection } =
  require("devtools/client/connection-manager");
let { Task } = require("resource://gre/modules/Task.jsm");
let promise = require("promise");
loader.lazyRequireGetter(this, "WindowFront",
                         "devtools/server/actors/window", true);
loader.lazyRequireGetter(this, "EventFront",
                         "devtools/server/actors/event", true);

/**
 * Manages a DevTools target for a given responsive viewport.  The owner
 * provides:
 *
 * {
 *   connect:   Connection -> Promise
 *     Configures the Connection as needed for the viewport and calls connect.
 *   bootstrap: this -> Promise
 *     Make any requests needed for the viewport to become online.
 *   select:    ListTabsResponse -> Promise(form)
 *     Given the list tabs response, retrieves the local form for this viewport.
 * }
 */
let ViewportTarget = exports.ViewportTarget = function(owner) {
  this.owner = owner;
  this.onTabListChanged = this.onTabListChanged.bind(this);
};

ViewportTarget.prototype = {

  get client() {
    return this.connection.client;
  },

  get window() {
    if (this._window) {
      return this._window;
    }
    this._window = new WindowFront(this.client, this.globalForm);
    return this._window;
  },

  get event() {
    if (this._event) {
      return this._event;
    }
    this._event = new EventFront(this.client, this.globalForm);
    return this._event;
  },

  get targetPromise() {
    if (this._targetPromise) {
      return this._targetPromise;
    }
    if (!this.form) {
      throw new Error("A form was never selected for this target.");
    }
    this._targetPromise = devtools.TargetFactory.forRemoteTab({
      form: this.form,
      client: this.client,
      chrome: false
    });
    return this._targetPromise;
  },

  init: Task.async(function*() {
    this.connection = ConnectionManager.createConnection("localhost", null);
    yield this.owner.connect(this.connection);
    yield this.waitForConnected(this.connection);
    this.client.addListener("tabListChanged", this.onTabListChanged);
    yield this.onTabListChanged();
    yield this.owner.bootstrap(this);
  }),

  waitForConnected: function(connection) {
    let deferred = promise.defer();
    connection.once(Connection.Events.CONNECTED, () => {
      deferred.resolve();
    });
    return deferred.promise;
  },

  destroy() {
    if (this.connection) {
      this.client.removeListener("tabListChanged", this.onTabListChanged);
      this.connection.disconnect();
    }
    this.connection = null;
    this.owner = null;
  },

  listTabs() {
    let deferred = promise.defer();
    this.client.mainRoot.listTabs(response => {
      deferred.resolve(response);
    });
    return deferred.promise;
  },

  onTabListChanged: Task.async(function*() {
    this.globalForm = yield this.listTabs();
    // It's up to |select| to find a meaningful value, and it may fail.
    this.form = yield this.owner.select(this.globalForm);
  }),

};
