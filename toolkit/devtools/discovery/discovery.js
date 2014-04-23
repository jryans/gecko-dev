/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Cu, CC, Cc, Ci } = require("chrome");
const EventEmitter = require("devtools/toolkit/event-emitter");
const { setInterval, clearInterval } = require("sdk/timers");

const UDPSocket = CC("@mozilla.org/network/udp-socket;1",
                     "nsIUDPSocket",
                     "init");

// TODO: Do we need to reserve these?
const PORT = 50624;
const ADDRESS = "224.0.0.200";

const { XPCOMUtils } = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});
const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});

XPCOMUtils.defineLazyGetter(this, "converter", () => {
  let conv = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
             createInstance(Ci.nsIScriptableUnicodeConverter);
  conv.charset = "utf8";
  return conv;
});

XPCOMUtils.defineLazyGetter(this, "sysInfo", () => {
  return Cc["@mozilla.org/system-info;1"].getService(Ci.nsIPropertyBag2);
});

if (Services.appinfo.name == "B2G") {
  XPCOMUtils.defineLazyGetter(this, "libcutils", function () {
    Cu.import("resource://gre/modules/systemlibs.js");
    return libcutils;
  });
}

function log(msg) {
  console.log("DISCOVERY: " + msg);
}

function Transport() {
  EventEmitter.decorate(this);
  try {
    this.socket = new UDPSocket(PORT, false);
    if (this.socket.joinMulticast) {
      this.socket.joinMulticast(ADDRESS);
    }
    this.socket.asyncListen(this);
  } catch(e) {
    log("Failed to start listening, trying random port: " + e);
    try {
      this.socket = new UDPSocket(-1, false);
      if (this.socket.joinMulticast) {
        this.socket.joinMulticast(ADDRESS);
      }
    } catch(e) {
      log("Failed to start new socket: " + e);
    }
  }
}

Transport.prototype = {

  send: function(object) {
    //log("Send:\n" + JSON.stringify(object, null, 2));
    let message = JSON.stringify(object);
    let rawMessage = converter.convertToByteArray(message);
    try {
      this.socket.send(ADDRESS, PORT, rawMessage, rawMessage.length);
    } catch(e) {
      log("Failed to send message: " + e);
    }
  },

  // nsIUDPSocketListener

  onPacketReceived: function(socket, message) {
    let messageData = message.data;
    let object = JSON.parse(messageData);
    object.from = message.fromAddr.address;
    log("Recv:\n" + JSON.stringify(object, null, 2));
    this.emit("message", object);
  },

  onStopListening: function(socket, status) {

  }

};

// TODO: Purge once heartbeat goes away.

function Discovery() {
  EventEmitter.decorate(this);
  this._transport = new Transport();
  this._getSystemInfo();
  this._transport.on("message", this._onRemoteUpdate.bind(this));
  //this.on("remote-update", () => log("Remote:\n" + JSON.stringify(this.remoteServicesByService)));
}

Discovery.prototype = {

  localServices: {},
  remoteServicesByService: {},
  // TODO: WTF?
  _heartbeat: { interval: null },

  addService: function(service, info) {
    if (Object.keys(this.localServices).length === 0) {
      this._startHeartbeat();
    }
    this.localServices[service] = info;
  },

  removeService: function(service) {
    delete this.localServices[service];
    if (Object.keys(this.localServices).length === 0) {
      this._stopHeartbeat();
    }
  },

  _getSystemInfo: function() {
    if (Services.appinfo.name == "B2G") {
      this.device = libcutils.property_get("ro.product.device");
    } else {
      this.device = sysInfo.get("host");
    }
    log("Device: " + this.device);
  },

  _startHeartbeat: function() {
    if (this._heartbeat.interval) {
      return;
    }
    this._heartbeat.interval = setInterval(() => {
      let status = {
        device: this.device,
        services: this.localServices
      };
      this._transport.send(status);
    }, 2000);
  },

  _stopHeartbeat: function() {
    if (!this._heartbeat.interval) {
      return;
    }
    clearInterval(this._heartbeat.interval);
    this._heartbeat.interval = null;
  },

  _onRemoteUpdate: function(e, update) {
    let remoteDevice = update.device;
    let remoteHost = update.from;
    for (let service in this.remoteServicesByService) {
      let byService = this.remoteServicesByService[service];
      let hadServiceForDevice = !!byService[remoteDevice];
      let haveServiceForDevice = service in update.services;
      if (hadServiceForDevice && !haveServiceForDevice) {
        delete byService[remoteDevice];
        log("REMOVED DEVICE");
        this.emit("device-removed", remoteDevice);
      }
    }
    for (let service in update.services) {
      let newDevice = !this.remoteServicesByService[service] ||
                      !this.remoteServicesByService[service][remoteDevice];
      let byService = this.remoteServicesByService[service] || {};
      let oldDeviceInfo = byService[remoteDevice];
      let newDeviceInfo = JSON.parse(JSON.stringify(update.services[service]));
      newDeviceInfo.host = remoteHost;
      byService[remoteDevice] = newDeviceInfo;
      this.remoteServicesByService[service] = byService;
      if (newDevice) {
        log("ADDED DEVICE");
        this.emit("device-added", remoteDevice, newDeviceInfo);
      }
      if (!newDevice &&
          JSON.stringify(oldDeviceInfo) != JSON.stringify(newDeviceInfo)) {
        log("UPDATED DEVICE");
        this.emit("device-updated", remoteDevice, newDeviceInfo);
      }
    }
    this.emit("remote-update");
  }

  // destroy: ???

};

let discovery = new Discovery();

module.exports = discovery;
