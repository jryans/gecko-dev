/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { DOM: dom, createClass, createFactory, PropTypes } =
  require("devtools/client/shared/vendor/react");

const Types = require("../types");
const Viewport = createFactory(require("./viewport"));

module.exports = createClass({

  displayName: "Viewports",

  propTypes: {
    devices: PropTypes.shape(Types.devices).isRequired,
    displayPixelRatio: PropTypes.number.isRequired,
    location: Types.location.isRequired,
    networkThrottling: PropTypes.shape(Types.networkThrottling).isRequired,
    screenshot: PropTypes.shape(Types.screenshot).isRequired,
    selectedDevice: PropTypes.string.isRequired,
    selectedPixelRatio: PropTypes.number.isRequired,
    touchSimulation: PropTypes.shape(Types.touchSimulation).isRequired,
    viewports: PropTypes.arrayOf(PropTypes.shape(Types.viewport)).isRequired,
    onBrowserMounted: PropTypes.func.isRequired,
    onChangeNetworkThrottling: PropTypes.func.isRequired,
    onChangeViewportDevice: PropTypes.func.isRequired,
    onChangeViewportPixelRatio: PropTypes.func.isRequired,
    onContentResize: PropTypes.func.isRequired,
    onResizeViewport: PropTypes.func.isRequired,
    onRotateViewport: PropTypes.func.isRequired,
    onScreenshot: PropTypes.func.isRequired,
    onUpdateDeviceModalOpen: PropTypes.func.isRequired,
    onUpdateTouchSimulation: PropTypes.func.isRequired,
  },

  render() {
    let {
      devices,
      displayPixelRatio,
      location,
      networkThrottling,
      screenshot,
      selectedDevice,
      selectedPixelRatio,
      touchSimulation,
      viewports,
      onBrowserMounted,
      onChangeNetworkThrottling,
      onChangeViewportDevice,
      onChangeViewportPixelRatio,
      onContentResize,
      onResizeViewport,
      onRotateViewport,
      onScreenshot,
      onUpdateDeviceModalOpen,
      onUpdateTouchSimulation,
    } = this.props;

    return dom.div(
      {
        id: "viewports",
      },
      viewports.map((viewport, i) => {
        return Viewport({
          key: viewport.id,
          devices,
          displayPixelRatio,
          location,
          networkThrottling,
          screenshot,
          selectedDevice,
          selectedPixelRatio,
          swapAfterMount: i == 0,
          touchSimulation,
          viewport,
          onBrowserMounted,
          onChangeNetworkThrottling,
          onChangeViewportDevice,
          onChangeViewportPixelRatio,
          onContentResize,
          onResizeViewport,
          onRotateViewport,
          onScreenshot,
          onUpdateDeviceModalOpen,
          onUpdateTouchSimulation,
        });
      })
    );
  },

});
