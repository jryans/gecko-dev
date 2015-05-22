/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Cu } = require("chrome");
const { Task } = Cu.import("resource://gre/modules/Task.jsm", {});
loader.lazyRequireGetter(this, "DevToolsUtils",
                         "devtools/toolkit/DevToolsUtils");

const HTML_NS = "http://www.w3.org/1999/xhtml";
const PORTAL_PREFIX = "chrome://browser/content/devtools/responsivedesign/portal.";

/**
 * A magic portal into another process.
 *
 * @param options
 *        {
 *          container: Element to host the portal
 *          surface: {
 *            width: Width of the cross process surface (including dPR)
 *            height: Height of the cross process surface (including dPR)
 *            surface: ID of the cross process surface
 *          }
 *        }
 */
let Portal = exports.Portal = function(options) {
  this.options = options;
  this.bound_draw = this.draw.bind(this);
};

Portal.prototype = {

  get container() {
    return this.options.container;
  },

  get document() {
    return this.container.ownerDocument;
  },

  get window() {
    return this.document.defaultView;
  },

  get surface() {
    return this.options.surface;
  },

  build: Task.async(function*() {
    this.canvas = this.document.createElementNS(HTML_NS, "canvas");
    this.canvas.setAttribute("width", this.surface.width);
    this.canvas.setAttribute("height", this.surface.height);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.container.appendChild(this.canvas);

    this.gl = this.canvas.getContext("webgl");
    this.initFeatures();
    yield this.initShaders();
    this.initBuffers();
    this.initUniforms();
    this.initTextures();
    this.window.requestAnimationFrame(this.bound_draw);
  }),

  destroy() {
    if (this.canvas) {
      this.canvas.remove();
    }
    this.gl = null;
    this.canvas = null;
  },

  draw() {
    if (!this.gl) {
      return;
    }
    this.gl.viewport(0, 0, this.surface.width, this.surface.height);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.verticesBuffer);
    this.gl.vertexAttribPointer(this.coordAttribute, 4, this.gl.FLOAT, false,
                                0, 0);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    this.window.requestAnimationFrame(this.bound_draw);
  },

  initTextures() {
    let texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_RECTANGLE, texture);
    this.gl.texImageIOSurface2D(this.surface.width, this.surface.height,
                                this.surface.surface);
    this.gl.texParameteri(this.gl.TEXTURE_RECTANGLE, this.gl.TEXTURE_MIN_FILTER,
                          this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_RECTANGLE, this.gl.TEXTURE_MAG_FILTER,
                          this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_RECTANGLE, this.gl.TEXTURE_WRAP_S,
                          this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_RECTANGLE, this.gl.TEXTURE_WRAP_T,
                          this.gl.CLAMP_TO_EDGE);
  },

  initFeatures() {
    this.gl.blendFuncSeparate(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA,
                              this.gl.ONE, this.gl.ONE);
    this.gl.enable(this.gl.BLEND);
  },

  initBuffers() {
    this.verticesBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.verticesBuffer);

    let vertices = [
      0.0,  0.0,  0.0,  0.0,
      1.0,  0.0,  0.0,  0.0,
      0.0,  1.0,  0.0,  0.0,
      1.0,  0.0,  0.0,  0.0,
      0.0,  1.0,  0.0,  0.0,
      1.0,  1.0,  0.0,  0.0,
    ];

    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices),
                       this.gl.STATIC_DRAW);
  },

  initUniforms() {
    let loc;
    let layerRects = [
      0, 0, this.surface.width, this.surface.height,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    loc = this.gl.getUniformLocation(this.shaderProgram, "uLayerRects");
    this.gl.uniform4fv(loc, new Float32Array(layerRects));

    let textureRects = [
      0, 0, 1, 1,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    loc = this.gl.getUniformLocation(this.shaderProgram, "uTextureRects");
    this.gl.uniform4fv(loc, new Float32Array(textureRects));

    let renderOffset = [
      0, 0, 0, 0,
    ];
    loc = this.gl.getUniformLocation(this.shaderProgram, "uRenderTargetOffset");
    this.gl.uniform4fv(loc, new Float32Array(renderOffset));

    let textureTransformVals = [
      1,  0, 0, 0,
      0, -1, 0, 0,
      0,  0, 1, 0,
      0,  1, 0, 1,
    ];
    loc = this.gl.getUniformLocation(this.shaderProgram, "uTextureTransform");
    this.gl.uniformMatrix4fv(loc, false,
                             new Float32Array(textureTransformVals));

    let layerTransformVals = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    loc = this.gl.getUniformLocation(this.shaderProgram, "uLayerTransform");
    this.gl.uniformMatrix4fv(loc, false, new Float32Array(layerTransformVals));

    let texCoordMultiplier = [
      this.surface.width, this.surface.height,
    ];
    loc = this.gl.getUniformLocation(this.shaderProgram, "uTexCoordMultiplier");
    this.gl.uniform2fv(loc, new Float32Array(texCoordMultiplier));

    let projectionVals = [
      2 / this.surface.width,   0, 0, 0,
      0, -2 / this.surface.height, 0, 0,
      0,                        0, 0, 0,
     -1,                        1, 0, 1,
    ];
    loc = this.gl.getUniformLocation(this.shaderProgram, "uMatrixProj");
    this.gl.uniformMatrix4fv(loc, false, new Float32Array(projectionVals));

    loc = this.gl.getUniformLocation(this.shaderProgram, "uTexture");
    this.gl.uniform1i(loc, 0);
  },

  initShaders: Task.async(function*() {
    let fragmentShader = yield this.getShader("fsh");
    let vertexShader = yield this.getShader("vsh");

    this.shaderProgram = this.gl.createProgram();
    this.gl.attachShader(this.shaderProgram, vertexShader);
    this.gl.attachShader(this.shaderProgram, fragmentShader);
    this.gl.linkProgram(this.shaderProgram);

    if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
      throw new Error("Unable to initialize the shader program.");
    }

    this.gl.useProgram(this.shaderProgram);

    this.coordAttribute = this.gl.getAttribLocation(this.shaderProgram, "aCoord");
    this.gl.enableVertexAttribArray(this.coordAttribute);
  }),

  getShader: Task.async(function*(type) {
    let shader;
    if (type === "fsh") {
      shader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
    } else if (type === "vsh") {
      shader = this.gl.createShader(this.gl.VERTEX_SHADER);
    } else {
      return null;
    }

    let source = yield DevToolsUtils.fetch(PORTAL_PREFIX + type);
    this.gl.shaderSource(shader, source.content);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error("An error occurred compiling the shaders: " +
                      this.gl.getShaderInfoLog(shader));
    }

    return shader;
  }),

};
