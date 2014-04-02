/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cu = Components.utils;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");
const {gDevTools} = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});

const {devtools} = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const {require} = devtools;

const {ConnectionManager, Connection}
  = require("devtools/client/connection-manager");
const {getDeviceFront} = require("devtools/server/actors/device");
const {getPreferenceFront} = require("devtools/server/actors/preference");
const {getTargetForApp, launchApp, closeApp}
  = require("devtools/app-actor-front");
const DeviceStore = require("devtools/app-manager/device-store");
const WebappsStore = require("devtools/app-manager/webapps-store");
const promise = require("sdk/core/promise");
const DEFAULT_APP_ICON = "chrome://browser/skin/devtools/app-manager/default-app-icon.png";

window.addEventListener("message", function(event) {
  try {
    let message = JSON.parse(event.data);
    if (message.name == "connection") {
      let cid = parseInt(message.cid);
      for (let c of ConnectionManager.connections) {
        if (c.uid == cid) {
          UI.connection = c;
          UI.onNewConnection();
          break;
        }
      }
    }
  } catch(e) {
    Cu.reportError(e);
  }
});

window.addEventListener("unload", function onUnload() {
  window.removeEventListener("unload", onUnload);
  UI.destroy();
});

let UI = {
  init: function() {
    this.showFooterIfNeeded();
    this.setTab("apps");
    if (this.connection) {
      this.onNewConnection();
    } else {
      this.hide();
   }
  },

  destroy: function() {
    if (this.connection) {
      this.connection.off(Connection.Events.STATUS_CHANGED, this._onConnectionStatusChange);
    }
    if (this.store) {
      this.store.destroy();
    }
    if (this.template) {
      this.template.destroy();
    }
  },

  showFooterIfNeeded: function() {
    let footer = document.querySelector("#connection-footer");
    if (window.parent == window) {
      // We're alone. Let's add a footer.
      footer.removeAttribute("hidden");
      footer.src = "chrome://browser/content/devtools/app-manager/connection-footer.xhtml";
    } else {
      footer.setAttribute("hidden", "true");
    }
  },

  hide: function() {
    document.body.classList.add("notconnected");
  },

  show: function() {
    document.body.classList.remove("notconnected");
  },

  onNewConnection: function() {
    this.connection.on(Connection.Events.STATUS_CHANGED, this._onConnectionStatusChange);

    // hold onto our deviceStore so we can emit and receive events other than
    // "set" which is the only thing mergeStores supports via special-case.
    this.deviceStore = new DeviceStore(this.connection);

    this.store = Utils.mergeStores({
      "device": this.deviceStore,
      "apps": new WebappsStore(this.connection),
    });

    if (this.template) {
      this.template.destroy();
    }
    this.template = new Template(document.body, this.store, Utils.l10n);

    this.template.start();
    this._onConnectionStatusChange();
  },

  setWallpaper: function(dataurl) {
    document.getElementById("meta").style.backgroundImage = "url(" + dataurl + ")";
  },

  _onConnectionStatusChange: function() {
    if (this.connection.status != Connection.Status.CONNECTED) {
      this.hide();
      this.listTabsResponse = null;
      this.device = null;
      this.prefs = null;
    } else {
      this.show();
      this.connection.client.listTabs(response => {
        this.listTabsResponse = response;
        this.device = getDeviceFront(this.connection.client,
                                     this.listTabsResponse);
        this.prefs = getPreferenceFront(this.connection.client,
                                        this.listTabsResponse);
        this.device.getWallpaper().then(longstr => {
          longstr.string().then(dataURL => {
            longstr.release().then(null, Cu.reportError);
            this.setWallpaper(dataURL);
          });
        });
      });
    }
  },

  get connected() { return !!this.listTabsResponse; },

  setTab: function(name) {
    var tab = document.querySelector(".tab.selected");
    var panel = document.querySelector(".tabpanel.selected");

    if (tab) tab.classList.remove("selected");
    if (panel) panel.classList.remove("selected");

    var tab = document.querySelector(".tab." + name);
    var panel = document.querySelector(".tabpanel." + name);

    if (tab) tab.classList.add("selected");
    if (panel) panel.classList.add("selected");
  },

  openToolboxForApp: function(manifest) {
    if (!this.connected) {
      return;
    }

    let app = this.store.object.apps.all.filter(a => a.manifestURL == manifest)[0];
    getTargetForApp(this.connection.client,
                    this.listTabsResponse.webappsActor,
                    manifest).then((target) => {

      top.UI.openAndShowToolboxForTarget(target, app.name, app.iconURL);
    }, console.error);
  },

  _getTargetForTab: function (form) {
      let options = {
        form: form,
        client: this.connection.client,
        chrome: false
      };
      let deferred = promise.defer();
      return devtools.TargetFactory.forRemoteTab(options);
  },

  openToolboxForTab: function (aNode) {
    let index = Array.prototype.indexOf.apply(
      aNode.parentNode.parentNode.parentNode.children,
      [aNode.parentNode.parentNode]);
    this.connection.client.listTabs(
      response => {
        let tab = response.tabs[index];
        this._getTargetForTab(tab).then(target => {
          top.UI.openAndShowToolboxForTarget(
            target, tab.title, DEFAULT_APP_ICON);
        }, console.error);
      }
    );
  },

  startApp: function(manifest) {
    if (!this.connected) {
      return promise.reject();
    }
    return launchApp(this.connection.client,
                     this.listTabsResponse.webappsActor,
                     manifest);
  },

  stopApp: function(manifest) {
    if (!this.connected) {
      return promise.reject();
    }
    return closeApp(this.connection.client,
                    this.listTabsResponse.webappsActor,
                    manifest);
  },

  /**
   * Given a click/dblclick event, figure out what preference it was on, if any.
   * Extract the data about the preference via the template's store object.
   */
  _getPrefFromEvent: function(event) {
    let elem = event.explicitOriginalTarget;
    // Immediately jump up to the first element.
    if (elem.nodeType !== 1) {
      elem = elem.parentElement;
    }
    while (elem && (elem.id !== "preference-table-body")) {
      if (elem.storeObject) {
        return elem.storeObject;
      }
      elem = elem.parentElement;
    }
    return null;
  },

  handlePreferenceContextMenu: function(event) {
    let pref = this._getPrefFromEvent(event);
    // Save off the preference that is the source of the right-click because
    // Gecko does not currently populate "relatedTarget" for menuitems.  It's
    // unclear from the spec if it should be doing so right now; it seems like
    // it was intended to happen, but that might have been removed from the
    // spec.
    this.activePref = pref;

    // Actions that require a preference to be the thing being right-clicked on
    // should be disabled appropriately.
    document.querySelector('#preference-modify').disabled = !pref;
    document.querySelector('#preference-clear').disabled = !pref;
  },

  modifyPref: function(event, pref) {
    if (!pref && event) {
      event.preventDefault(); // prevent text selection from a double click
      event.stopPropagation();
      pref = this._getPrefFromEvent(event);
    }
    if (!pref) {
      return;
    }

    switch (pref.type) {
      case "string":
        let newStringVal = window.prompt(pref.name, pref.value);
        if (newStringVal !== null && newStringVal !== pref.value) {
          pref.value = newStringVal;
        }
        break;

      case "integer":
        let intString = window.prompt(pref.name, pref.value.toString());
        if (intString !== null) {
          let intVal = parseInt(intString, 10);
          if (intVal !== pref.value && !isNaN(intVal)) {
            pref.value = intVal;
          }
        }
        break;

      case "boolean":
        // we can just toggle this one (like in about:config)
        pref.value = !pref.value;
        break;
    }
  },

  clearPref: function(pref) {
    if (!pref) {
      return;
    }

    this.prefs.clearUserPref(pref.name);
    // The right thing to do here would be to check what the new value (if
    // any) of the preference is after clearing and then update our value if
    // it's still around.  Unfortunately, I'm not sure the communication idiom
    // for interacting with the store through this.
    //
    // And if there is no longer a preference after the clearing, then we would
    // ideally remove the element, but I'm afraid of the template.js scaling
    // issues.
    pref.type = "cleared";
    pref.value = "cleared";
  },

  createPref: function(prefType, prefDefault) {
    let prefName = window.prompt(Utils.l10n("preferences.newPrefNamePrompt"));
    // bail if the user canceled (null) or they didn't enter anything
    if (!prefName) {
      return;
    }
    let value;
    switch (prefType) {
      case "string":
        value = window.prompt(prefName, prefDefault);
        // Bail if the user canceled, but do allow empty strings
        if (value === null) {
          return;
        }
        this.prefs.setCharPref(prefName, value);
        break;

      case "integer":
        let intString = window.prompt(prefName, prefDefault);
        if (intString === null) {
          return;
        }
        value = parseInt(intString, 10);
        if (isNaN(value)) {
          return;
        }
        this.prefs.setIntPref(prefName, value);
        break;

      case "boolean":
        value = prefDefault;
        this.prefs.setBoolPref(prefName, value);
        break;
    }
    // This causes the UI to append the new preference, but it takes a loooong
    // time like it's actually updating everything else too.  Invoking sort
    // seems like it would turn out worse, and splice seems like it would
    // (hopefully) just corrupt things, so we don't sort.
    // TODO make this not super-slow
    this.store.object.device.preferences.push({
      name: prefName,
      type: prefType,
      value: value,
      hasUserValue: true
    });
  },

  updatePreferenceFilter: function() {
    function toggleClass(elems, clazz, beThere) {
      for (var elem of elems) {
        elem.classList.toggle(clazz, beThere);
      }
    }

    // Make all preferences visible again!
    let bodyElem = document.querySelector("#preference-table-body");
    toggleClass(bodyElem.querySelectorAll(".preference"),
                "preference-filtered-out", false);

    let filterValue = document.querySelector("#preference-filter").value;
    // Sanitize quotes out for selector, and because we don't want them anyways.
    filterValue = filterValue.replace(/["']/g, "");

    // bail if the filter was cleared or effectively requests nothing
    if (!filterValue) {
      return;
    }

    let nonmatchingSelector =
          ".preference:not([data-pref-value*=\"" + filterValue + "\"])";
    let nonmatchingElements = bodyElem.querySelectorAll(nonmatchingSelector);
    toggleClass(nonmatchingElements, "preference-filtered-out", true);
  },

  refreshPreferences: function() {
    this.deviceStore.getDevicePreferencesTable().then(() => {
      this.updatePreferenceFilter();
    });
  }
};

// This must be bound immediately, as it might be used via the message listener
// before UI.init() has been called.
UI._onConnectionStatusChange = UI._onConnectionStatusChange.bind(UI);
