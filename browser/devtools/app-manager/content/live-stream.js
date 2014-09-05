/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cu = Components.utils;
Cu.import("resource:///modules/devtools/gDevTools.jsm");
const {devtools} = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const {require} = devtools;
const {ConnectionManager, Connection} = require("devtools/client/connection-manager");
const {getDeviceFront} = require("devtools/server/actors/device");
const {Services} = Cu.import("resource://gre/modules/Services.jsm");
const {EventEmitter} = Cu.import("resource://gre/modules/devtools/event-emitter.js");
const promise = require("sdk/core/promise");

window.addEventListener("message", function(event) {
  try {
    let json = JSON.parse(event.data);
    if (json.name == "connection") {
      let cid = parseInt(json.cid);
      for (let c of ConnectionManager.connections) {
        if (c.uid == cid) {
          UI.connection = c;
          UI.onNewConnection();
          break;
        }
      }
    } else if (json.name === "live-stream") {
      UI[json.action]();
    }
  } catch(e) {}
});

window.addEventListener("unload", function onUnload() {
  window.removeEventListener("unload", onUnload);
  UI.destroy();
});

let UI = {

  isReady: false,

  streaming: false,

  onload: function() {
    this.video = document.querySelector("video");
    this.isReady = true;
    this.emit("ready");
  },

  destroy: function() {
    if (this.connection) {
      this.connection.off(Connection.Events.STATUS_CHANGED, this._onConnectionStatusChange);
    }
  },

  onNewConnection: function() {
    this.connection.on(Connection.Events.STATUS_CHANGED, this._onConnectionStatusChange);
    this._onConnectionStatusChange();
  },

  _onConnectionStatusChange: function() {
    if (this.connection.status != Connection.Status.CONNECTED) {
      document.body.classList.remove("connected");
      this.listTabsResponse = null;
    } else {
      document.body.classList.add("connected");
      this.connection.client.listTabs(response => {
        this.listTabsResponse = response;
        this.device =
          getDeviceFront(this.connection.client, this.listTabsResponse);
      });
    }
  },

  get connected() { return !!this.listTabsResponse; },

  toggle: function() {
    if (this.streaming) {
      this.stop();
    } else {
      this.start();
    }
  },

  start: function() {
    console.log("start live stream");
    this.streaming = true;
    window.frameElement.setAttribute("streaming", "true");

    let pc = this.pc = new mozRTCPeerConnection();

    pc.onaddstream = event => {
      console.log("Got stream!");
      this.video.mozSrcObject = event.stream;
      this.video.play();
    };

    let timer = setInterval(() => {
      if (this.video.videoHeight > 0) {
        clearInterval(timer);
        console.log("Got a size");
        this.video.height = this.video.videoHeight;
        this.video.width = this.video.videoWidth;
      }
    }, 1000);

    this.device.on("ice", candidate => {
      console.log("Got ICE candidate from server");
      pc.addIceCandidate(new mozRTCIceCandidate(candidate));
    });

    pc.onicecandidate = obj => {
      console.log("Client has ICE candidate");
    };

    this.device.startLiveStream().then(offer => {
      console.log("Got offer");
      pc.setRemoteDescription(new mozRTCSessionDescription(offer));
      pc.createAnswer(answer => {
        pc.setLocalDescription(answer);
        console.log("Sending answer");
        this.device.setLiveStreamAnswer(JSON.parse(JSON.stringify(answer)));
      }, () => {
        console.log("ERR!");
      });
    }, console.log);
  },

  stop: function() {
    console.log("stop live stream");
    this.streaming = false;
    window.frameElement.removeAttribute("streaming");
    this.device.stopLiveStream();
  }

};

// This must be bound immediately, as it might be used via the message listener
// before UI.onload() has been called.
UI._onConnectionStatusChange = UI._onConnectionStatusChange.bind(UI);

EventEmitter.decorate(UI);
