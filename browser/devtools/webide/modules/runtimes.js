/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {Cu} = require("chrome");
const {Devices} = Cu.import("resource://gre/modules/devtools/Devices.jsm");
const {Services} = Cu.import("resource://gre/modules/Services.jsm");
const {Simulator} = Cu.import("resource://gre/modules/devtools/Simulator.jsm");
const {ConnectionManager, Connection} = require("devtools/client/connection-manager");
const {DebuggerServer} = require("resource://gre/modules/devtools/dbg-server.jsm");
const discovery = require("devtools/toolkit/discovery/discovery");
const EventEmitter = require("devtools/toolkit/event-emitter");
const promise = require("promise");

const Strings = Services.strings.createBundle("chrome://browser/locale/devtools/webide.properties");

/**
 * Runtime and Scanner API
 *
 * |RuntimeScanners| maintains a set of |Scanner| objects that produce one or
 * more |Runtime|s to connect to.  Add-ons can extend the set of known runtimes
 * by registering additional |Scanner|s that emit them.
 *
 * Each |Scanner| must support the following API:
 *
 * * enable()
 *   Bind any event handlers and start any background work the scanner needs to
 *   maintain an updated set of |Runtime|s.
 *   Called when there is a consumer (such as WebIDE) actively interested in
 *   maintaining the |Runtime| list.
 * * 
 */

// These type strings are used for logging events to Telemetry.
// You must update Histograms.json if new types are added.
let RuntimeTypes = exports.RuntimeTypes = {
  USB: "USB",
  WIFI: "WIFI",
  SIMULATOR: "SIMULATOR",
  REMOTE: "REMOTE",
  LOCAL: "LOCAL"
};

// TODO: Create a separate UI category

/**
 * TODO: Bug XXX to remove this in the future?
 * OR: Force re-install of ADB Helper with new enough version?
 * This runtime exists to support the ADB Helper add-on below version XXX.
 */
function DeprecatedUSBRuntime(id) {
  this.id = id;
}

DeprecatedUSBRuntime.prototype = {
  type: RuntimeTypes.USB,
  connect: function(connection) {
    let device = Devices.getByName(this.id);
    if (!device) {
      return promise.reject("Can't find device: " + this.getName());
    }
    return device.connect().then((port) => {
      connection.host = "localhost";
      connection.port = port;
      connection.connect();
    });
  },
  getID: function() {
    return this.id;
  },
  getName: function() {
    return this._productModel || this.id;
  },
  updateNameFromADB: function() {
    if (this._productModel) {
      return promise.reject();
    }
    let device = Devices.getByName(this.id);
    let deferred = promise.defer();
    if (device && device.shell) {
      device.shell("getprop ro.product.model").then(stdout => {
        this._productModel = stdout;
        deferred.resolve();
      }, () => {});
    } else {
      this._productModel = null;
      deferred.reject();
    }
    return deferred.promise;
  },
}

function WiFiRuntime(deviceName) {
  this.deviceName = deviceName;
}

WiFiRuntime.prototype = {
  type: RuntimeTypes.WIFI,
  connect: function(connection) {
    let service = discovery.getRemoteService("devtools", this.deviceName);
    if (!service) {
      return promise.reject("Can't find device: " + this.getName());
    }
    connection.host = service.host;
    connection.port = service.port;
    connection.connect();
    return promise.resolve();
  },
  getID: function() {
    return this.deviceName;
  },
  getName: function() {
    return this.deviceName;
  },
}

function SimulatorRuntime(version) {
  this.version = version;
}

SimulatorRuntime.prototype = {
  type: RuntimeTypes.SIMULATOR,
  connect: function(connection) {
    let port = ConnectionManager.getFreeTCPPort();
    let simulator = Simulator.getByVersion(this.version);
    if (!simulator || !simulator.launch) {
      return promise.reject("Can't find simulator: " + this.getName());
    }
    return simulator.launch({port: port}).then(() => {
      connection.host = "localhost";
      connection.port = port;
      connection.keepConnecting = true;
      connection.once(Connection.Events.DISCONNECTED, simulator.close);
      connection.connect();
    });
  },
  getID: function() {
    return this.version;
  },
  getName: function() {
    let simulator = Simulator.getByVersion(this.version);
    if (!simulator) {
      return "Unknown";
    }
    return Simulator.getByVersion(this.version).appinfo.label;
  },
}

let gLocalRuntime = {
  type: RuntimeTypes.LOCAL,
  connect: function(connection) {
    if (!DebuggerServer.initialized) {
      DebuggerServer.init();
      DebuggerServer.addBrowserActors();
    }
    connection.host = null; // Force Pipe transport
    connection.port = null;
    connection.connect();
    return promise.resolve();
  },
  getName: function() {
    return Strings.GetStringFromName("local_runtime");
  },
  getID: function () {
    return "local";
  }
}

let gRemoteRuntime = {
  type: RuntimeTypes.REMOTE,
  connect: function(connection) {
    let win = Services.wm.getMostRecentWindow("devtools:webide");
    if (!win) {
      return promise.reject();
    }
    let ret = {value: connection.host + ":" + connection.port};
    let title = Strings.GetStringFromName("remote_runtime_promptTitle");
    let message = Strings.GetStringFromName("remote_runtime_promptMessage");
    let ok = Services.prompt.prompt(win, title, message, ret, null, {});
    let [host,port] = ret.value.split(":");
    if (!ok) {
      return promise.reject({canceled: true});
    }
    if (!host || !port) {
      return promise.reject();
    }
    connection.host = host;
    connection.port = port;
    connection.connect();
    return promise.resolve();
  },
  getName: function() {
    return Strings.GetStringFromName("remote_runtime");
  },
}

/* SCANNERS */

let RuntimeScanners = {

  _scanners: new Set(),

  add(scanner) {
    if (this._enabled) {
      // Enable any scanner added while globally enabled
      this._enableScanner(scanner);
    }
    this._scanners.add(scanner);
    this._emitUpdated();
  },

  remove(scanner) {
    this._scanners.delete(scanner);
    if (this._enabled) {
      // Disable any scanner removed while globally enabled
      this._disableScanner(scanner);
    }
    this._emitUpdated();
  },

  has(scanner) {
    return this._scanners.has(scanner);
  },

  scan() {
    if (!this._enabled) {
      return promise.resolve();
    }

    let promises = [];

    for (let scanner of this._scanners) {
      promises.push(scanner.scan());
    }

    return promise.all(promises);
  },

  listRuntimes: function*() {
    for (let scanner of this._scanners) {
      for (let runtime of scanner.listRuntimes()) {
        yield runtime;
      }
    }
  },

  _emitUpdated() {
    this.emit("runtime-list-updated");
  },

  enable() {
    this._enabled = true;
    this._emitUpdated = this._emitUpdated.bind(this);
    for (let scanner of this._scanners) {
      this._enableScanner(scanner);
    }
  },

  _enableScanner(scanner) {
    scanner.enable();
    scanner.on("runtime-list-updated", this._emitUpdated);
  },

  disable() {
    for (let scanner of this._scanners) {
      this._disableScanner(scanner);
    }
    this._enabled = false;
  },

  _disableScanner(scanner) {
    scanner.off("runtime-list-updated", this._emitUpdated);
    scanner.disable();
  },

};

EventEmitter.decorate(RuntimeScanners);

exports.RuntimeScanners = RuntimeScanners;

// TODO: Doc Runtime API
// * type
// * category
// * clean up alex's runtime remembering

let SimulatorScanner = {

  _runtimes: [],

  enable() {
    this._runtimesUpdated = this._runtimesUpdated.bind(this);
    Simulator.on("register", this._runtimesUpdated);
    Simulator.on("unregister", this._runtimesUpdated);
    this._runtimesUpdated();
  },

  disable() {
    Simulator.off("register", this._runtimesUpdated);
    Simulator.off("unregister", this._runtimesUpdated);
  },

  _emitUpdated() {
    this.emit("runtime-list-updated");
  },

  _runtimesUpdated() {
    this._runtimes = [];
    for (let version of Simulator.availableVersions()) {
      this._runtimes.push(new SimulatorRuntime(version));
    }
    this._emitUpdated();
  },

  scan() {
    return promise.resolve();
  },

  listRuntimes: function() {
    return this._runtimes;
  }

};

EventEmitter.decorate(SimulatorScanner);
RuntimeScanners.add(SimulatorScanner);

/**
 * TODO: Bug XXX to remove this in the future?
 * OR: Force re-install of ADB Helper with new enough version?
 * This runtime exists to support the ADB Helper add-on below version XXX.
 */
let DeprecatedAdbScanner = {

  _runtimes: [],

  enable() {
    this._runtimesUpdated = this._runtimesUpdated.bind(this);
    Devices.on("register", this._runtimesUpdated);
    Devices.on("unregister", this._runtimesUpdated);
    Devices.on("addon-status-updated", this._runtimesUpdated);
    this._runtimesUpdated();
  },

  disable() {
    Devices.off("register", this._runtimesUpdated);
    Devices.off("unregister", this._runtimesUpdated);
    Devices.off("addon-status-updated", this._runtimesUpdated);
  },

  _emitUpdated() {
    this.emit("runtime-list-updated");
  },

  _runtimesUpdated() {
    this._runtimes = [];
    for (let id of Devices.available()) {
      let runtime = new DeprecatedUSBRuntime(id);
      this._runtimes.push(runtime);
      runtime.updateNameFromADB().then(() => {
        this._emitUpdated();
      }, () => {});
    }
    this._emitUpdated();
  },

  scan() {
    return promise.resolve();
  },

  listRuntimes: function() {
    return this._runtimes;
  }

};

EventEmitter.decorate(DeprecatedAdbScanner);
RuntimeScanners.add(DeprecatedAdbScanner);

let WiFiScanner = {

  _runtimes: [],

  init() {
    this.updateRegistration();
    Services.prefs.addObserver(this.ALLOWED_PREF, this, false);
  },

  enable() {
    this._runtimesUpdated = this._runtimesUpdated.bind(this);
    discovery.on("devtools-device-added", this._runtimesUpdated);
    discovery.on("devtools-device-updated", this._runtimesUpdated);
    discovery.on("devtools-device-removed", this._runtimesUpdated);
    this._runtimesUpdated();
  },

  disable() {
    discovery.off("devtools-device-added", this._runtimesUpdated);
    discovery.off("devtools-device-updated", this._runtimesUpdated);
    discovery.off("devtools-device-removed", this._runtimesUpdated);
  },

  _emitUpdated() {
    this.emit("runtime-list-updated");
  },

  _runtimesUpdated() {
    this._runtimes = [];
    for (let device of discovery.getRemoteDevicesWithService("devtools")) {
      this._runtimes.push(new WiFiRuntime(device));
    }
    this._emitUpdated();
  },

  scan() {
    discovery.scan();
    return promise.resolve();
  },

  listRuntimes: function() {
    return this._runtimes;
  },

  ALLOWED_PREF: "devtools.remote.wifi.scan",

  get allowed() {
    return Services.prefs.getBoolPref(this.ALLOWED_PREF);
  },

  updateRegistration() {
    if (this.allowed) {
      RuntimeScanners.add(WiFiScanner);
    } else {
      RuntimeScanners.remove(WiFiScanner);
    }
    this._emitUpdated();
  },

  observe(subject, topic, data) {
    if (data !== WiFiScanner.ALLOWED_PREF) {
      return;
    }
    WiFiScanner.updateRegistration();
  }

};

EventEmitter.decorate(WiFiScanner);
WiFiScanner.init();

exports.WiFiScanner = WiFiScanner;
