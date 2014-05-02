/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const { Cu } = require("chrome");
const { Promise: promise } =
  Cu.import("resource://gre/modules/Promise.jsm", {});
const Services = require("Services");
const { setTimeout } = require("sdk/timers");

// Lazily require encoder and decoder in case only one is needed
Object.defineProperty(this, "Encoder", {
  get: () => require("./encoder/index").Encoder
});
Object.defineProperty(this, "QRRSBlock", {
  get: () => require("./encoder/index").QRRSBlock
});
Object.defineProperty(this, "QRErrorCorrectLevel", {
  get: () => require("./encoder/index").QRErrorCorrectLevel
});
Object.defineProperty(this, "decoder", {
  get: () => require("./decoder/index")
});

/**
 * There are many "versions" of QR codes, which describes how many dots appear
 * in the resulting image, thus limiting the amount of data that can be
 * represented.
 *
 * The encoder used here allows for versions 1 - 10 (more dots for larger
 * versions).
 *
 * It expects you to pick a version large enough to contain your message.  Here
 * we search for the mimimum version based on the message length.
 * @param string message
 *        Text to encode
 * @param string quality
 *        Quality level: L, M, Q, H
 * @return integer
 */
exports.findMinimumVersion = function(message, quality) {
  let msgLength = message.length;
  let qualityLevel = QRErrorCorrectLevel[quality];
  for (let version = 1; version <= 10; version++) {
    let rsBlocks = QRRSBlock.getRSBlocks(version, qualityLevel);
    let maxLength = rsBlocks.reduce((prev, block) => {
      return prev + block.dataCount;
    }, 0);
    // Remove two bytes to fit header info
    maxLength -= 2;
    if (msgLength <= maxLength) {
      return version;
    }
  }
  throw new Error("Message too large");
};

/**
 * Simple wrapper around the underlying encoder's API.
 * @param string  message
 *        Text to encode
 * @param string  quality (optional)
          Quality level: L, M, Q, H
 * @param integer version (optional)
 *        QR code "version" large enough to contain the message
 * @return object with the following fields:
 *   * src:    an image encoded a data URI
 *   * height: image height
 *   * width:  image width
 */
exports.encodeToDataURI = function(message, quality, version) {
  quality = quality || "H";
  version = version || exports.findMinimumVersion(message, quality);
  let encoder = new Encoder(version, quality);
  encoder.addData(message);
  encoder.make();
  return encoder.createImgData();
};

/**
 * Simple wrapper around the underlying decoder's API.
 * @param string dataURI
 *        A data URI of an image of a QR code
 * @return Promise
 *         The promise will be resolved with a string, which is the data inside
 *         the QR code.
 */
exports.decodeFromDataURI = function(dataURI) {
  let deferred = promise.defer();
  decoder.decodeFromDataURI(dataURI, deferred.resolve);
  return deferred.promise;
};

/**
 * Decode a QR code that has been drawn to a canvas element.
 * @param Canvas canvas
 *        <canvas> element to read from
 * @return string
 *         The data inside the QR code
 */
exports.decodeFromCanvas = function(canvas) {
  return decoder.decodeFromCanvas(canvas);
};

function getWindow() {
  let { DebuggerServer } = require("devtools/server/main");
  return Services.wm.getMostRecentWindow(DebuggerServer.chromeWindowType);
}

function setupCanvas() {
  let window = getWindow();
  let canvas = window.document.createElementNS(HTML_NS, "canvas");
  canvas.width = 800;
  canvas.height = 600;
  return canvas;
}

function setupVideo() {
  let window = getWindow();
  return window.document.createElementNS(HTML_NS, "video");
}

exports.decodeFromCamera = function() {
  let deferred = promise.defer();

  let navigator = getWindow().navigator;
  let getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia;
  getUserMedia = getUserMedia.bind(navigator);

  getUserMedia({ video: true, audio: false }, stream => {
    let video = setupVideo();
    video.mozSrcObject = stream;
    video.play();

    let canvas = setupCanvas();
    let context = canvas.getContext("2d");

    function attemptCapture() {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        let result = exports.decodeFromCanvas(canvas);
        console.log("DECODE: " + result);
      } catch(e) {
        console.error(e);
        setTimeout(attemptCapture, 1000);
      }
    }
    attemptCapture();
  }, () => deferred.reject("Unable to access camera"));

  return deferred.promise;
};
