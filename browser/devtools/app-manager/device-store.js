/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const ObservableObject = require("devtools/shared/observable-object");
const {getDeviceFront} = require("devtools/server/actors/device");
const {getPreferenceFront} = require("devtools/server/actors/preference");
const {Connection} = require("devtools/client/connection-manager");

const {Cu} = require("chrome");
const promise = require("sdk/core/promise");

const _knownDeviceStores = new WeakMap();

let DeviceStore;

module.exports = DeviceStore = function(connection) {
  // If we already know about this connection,
  // let's re-use the existing store.
  if (_knownDeviceStores.has(connection)) {
    return _knownDeviceStores.get(connection);
  }

  _knownDeviceStores.set(connection, this);

  ObservableObject.call(this, {});

  this.getDevicePreferencesTable = this.getDevicePreferencesTable.bind(this);

  this._resetStore();

  this.destroy = this.destroy.bind(this);
  this._onStatusChanged = this._onStatusChanged.bind(this);

  this._connection = connection;
  this._connection.once(Connection.Events.DESTROYED, this.destroy);
  this._connection.on(Connection.Events.STATUS_CHANGED, this._onStatusChanged);
  this._onTabListChanged = this._onTabListChanged.bind(this);
  this._onStatusChanged();
  this._onStoreChanged = this._onStoreChanged.bind(this);
  this.on("set", this._onStoreChanged);
  return this;
};

DeviceStore.prototype = {
  destroy: function() {
    if (this._connection) {
      // While this.destroy is bound using .once() above, that event may not
      // have occurred when the DeviceStore client calls destroy, so we
      // manually remove it here.
      this._connection.off(Connection.Events.DESTROYED, this.destroy);
      this._connection.off(Connection.Events.STATUS_CHANGED, this._onStatusChanged);
      _knownDeviceStores.delete(this._connection);
      this._connection = null;
    }
    this.off("set", this._onStoreChanged);
    this._onStoreChanged = null;
  },

  _resetStore: function() {
    this.object.description = {};
    this.object.permissions = [];
    this.object.tabs = [];
    this.object.preferences = [];
  },

  _onStatusChanged: function() {
    if (this._connection.status == Connection.Status.CONNECTED) {
      this._listTabs();
    } else {
      this._resetStore();
    }
  },

  _onTabListChanged: function() {
    this._listTabs();
  },

  _listTabs: function() {
    this._connection.client.listTabs((resp) => {
      if (resp.error) {
        this._connection.disconnect();
        return;
      }
      this._deviceFront = getDeviceFront(this._connection.client, resp);
      // Older devices and those that forbid-certified-apps won't have a
      // perference actor, so we must check for it
      if (resp.preferenceActor) {
        this._preferenceFront = getPreferenceFront(this._connection.client, resp);
      }
      // Save remote browser's tabs
      this.object.tabs = resp.tabs;
      // Add listener to update remote browser's tabs list in app-manager
      // when it changes
      this._connection.client.addListener(
        "tabListChanged", this._onTabListChanged);
      this._feedStore();
    });
  },

  _feedStore: function() {
    this._getDeviceDescription();
    this._getDevicePermissionsTable();
    this.getDevicePreferencesTable();
  },

  _getDeviceDescription: function() {
    return this._deviceFront.getDescription()
    .then(json => {
      json.dpi = Math.ceil(json.dpi);
      this.object.description = json;
    });
  },

  _getDevicePermissionsTable: function() {
    return this._deviceFront.getRawPermissionsTable()
    .then(json => {
      let permissionsTable = json.rawPermissionsTable;
      let permissionsArray = [];
      for (let name in permissionsTable) {
        permissionsArray.push({
          name: name,
          app: permissionsTable[name].app,
          privileged: permissionsTable[name].privileged,
          certified: permissionsTable[name].certified,
        });
      }
      this.object.permissions = permissionsArray;
    });
  },

  getDevicePreferencesTable: function() {
    if (!this._preferenceFront) {
      return promise.resolve();
    }
    return this._preferenceFront.getAllPrefs()
    .then(preferencesTable => {
      let preferencesArray = [];
      for (let name in preferencesTable) {
        let prefInfo = preferencesTable[name];
        let type = typeof(prefInfo.value);
        if (type === "number") {
          type = "integer";
        }
        preferencesArray.push({
          name: name,
          type: type,
          value: prefInfo.value,
          hasUserValue: prefInfo.hasUserValue
        });
      }
      preferencesArray.sort(function(a, b) {
        return a.name > b.name ? 1 : -1;
      });
      this.object.preferences = preferencesArray;
    });
  },

  _onStoreChanged: function(event, path, value) {
    console.log(path);
    if (path.length === 3 && path[0] === "preferences" && path[2] === "value") {
      this._onPrefModified(path[1], value);
    }
  },

  _onPrefModified: function(index, value) {
    let pref = this.object.preferences[index];
    switch (pref.type) {
      case "string":
        this._preferenceFront.setCharPref(pref.name, value);
        break;

      case "integer":
        this._preferenceFront.setIntPref(pref.name, value);
        break;

      case "boolean":
        this._preferenceFront.setBoolPref(pref.name, value);
        break;
    }
  }
};
