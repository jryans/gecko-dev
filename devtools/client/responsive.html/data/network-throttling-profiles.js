/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const K = 1024;
const M = 1024 * 1024;

/* eslint-disable key-spacing */
module.exports = [
  {
    id:          "GPRS",
    downloadBPS: 50 * K,
    uploadBPS:   20 * K,
    latency:     500,
  },
  {
    id:          "Regular 2G",
    downloadBPS: 250 * K,
    uploadBPS:   50 * K,
    latency:     300,
  },
  {
    id:          "Good 2G",
    downloadBPS: 450 * K,
    uploadBPS:   150 * K,
    latency:     150,
  },
  {
    id:          "Regular 3G",
    downloadBPS: 750 * K,
    uploadBPS:   250 * K,
    latency:     100,
  },
  {
    id:          "Good 3G",
    downloadBPS: 1.5 * M,
    uploadBPS:   750 * K,
    latency:     40,
  },
  {
    id:          "Regular 4G",
    downloadBPS: 4 * M,
    uploadBPS:   3 * M,
    latency:     20,
  },
  {
    id:          "DSL",
    downloadBPS: 2 * M,
    uploadBPS:   1 * M,
    latency:     5,
  },
  {
    id:          "WiFi",
    downloadBPS: 30 * M,
    uploadBPS:   15 * M,
    latency:     2,
  },
];
/* eslint-enable key-spacing */
