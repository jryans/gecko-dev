/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { DOM: dom, createClass, createFactory, PropTypes } =
  require("devtools/client/shared/vendor/react");

const Types = require("../types");
const DeviceSelector = createFactory(require("./device-selector"));
const ResizableViewport = createFactory(require("./resizable-viewport"));
const ViewportDimension = createFactory(require("./viewport-dimension"));
const ViewportSideToolbar = createFactory(require("./viewport-side-toolbar"));

module.exports = createClass({

  displayName: "Viewport",

  propTypes: {
    devices: PropTypes.shape(Types.devices).isRequired,
    displayPixelRatio: PropTypes.number.isRequired,
    location: Types.location.isRequired,
    networkThrottling: PropTypes.shape(Types.networkThrottling).isRequired,
    screenshot: PropTypes.shape(Types.screenshot).isRequired,
    selectedDevice: PropTypes.string.isRequired,
    selectedPixelRatio: PropTypes.number.isRequired,
    swapAfterMount: PropTypes.bool.isRequired,
    touchSimulation: PropTypes.shape(Types.touchSimulation).isRequired,
    viewport: PropTypes.shape(Types.viewport).isRequired,
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

  onChangeViewportDevice(device) {
    let {
      viewport,
      onChangeViewportDevice,
    } = this.props;

    onChangeViewportDevice(viewport.id, device);
  },

  onResizeViewport(width, height) {
    let {
      viewport,
      onResizeViewport,
    } = this.props;

    onResizeViewport(viewport.id, width, height);
  },

  onRotateViewport() {
    let {
      viewport,
      onRotateViewport,
    } = this.props;

    onRotateViewport(viewport.id);
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
      swapAfterMount,
      touchSimulation,
      viewport,
      onBrowserMounted,
      onChangeNetworkThrottling,
      onChangeViewportPixelRatio,
      onContentResize,
      onScreenshot,
      onUpdateDeviceModalOpen,
      onUpdateTouchSimulation,
    } = this.props;

    let {
      onChangeViewportDevice,
      onRotateViewport,
      onResizeViewport,
    } = this;

    return dom.div(
      {
        className: "viewport",
      },
      DeviceSelector({
        devices,
        selectedDevice,
        onChangeViewportDevice,
        onResizeViewport,
        onUpdateDeviceModalOpen,
      }),
      ViewportDimension({
        viewport,
        onChangeViewportDevice,
        onResizeViewport,
      }),
      dom.div(
        {
          className: "viewport-body",
        },
        ViewportSideToolbar({
          devices,
          displayPixelRatio,
          networkThrottling,
          screenshot,
          selectedDevice,
          selectedPixelRatio,
          touchSimulation,
          onChangeNetworkThrottling,
          onChangeViewportPixelRatio,
          onRotateViewport,
          onScreenshot,
          onUpdateTouchSimulation,
        }),
        ResizableViewport({
          devices,
          location,
          screenshot,
          swapAfterMount,
          viewport,
          onBrowserMounted,
          onChangeViewportDevice,
          onContentResize,
          onResizeViewport,
          onRotateViewport,
          onUpdateDeviceModalOpen,
        }),
      ),
    );
  },

});
