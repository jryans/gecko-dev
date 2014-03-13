/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
let { NetUtil } = Cu.import("resource://gre/modules/NetUtil.jsm", {});
let Pipe = CC("@mozilla.org/pipe;1", "nsIPipe", "init");

const LOG_PREF = "devtools.debugger.log";
const VERBOSE_PREF = "devtools.debugger.log.verbose";
let wantLogging = Services.prefs.getBoolPref(LOG_PREF);
let wantVerbose =
  Services.prefs.getPrefType(VERBOSE_PREF) !== Services.prefs.PREF_INVALID &&
  Services.prefs.getBoolPref(VERBOSE_PREF);

/**
 * A verbose logger for low-level transport tracing.
 * @param function msgFactory
 *        A function that returns the message to log (so that arguments aren't
 *        computed unless they'll be used)
 */
this.dumpv = function dumpv(msgFactory) {
  if (wantVerbose) {
    dumpn(msgFactory());
  }
};

// TODO: Bug 859372 - Convert away from subscripts once debugger server is fully
// loaderized.
let loader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
             .getService(Ci.mozIJSSubScriptLoader);
loader.loadSubScript(
  "resource://gre/modules/devtools/transport/stream-copier.js", this);
loader.loadSubScript(
  "resource://gre/modules/devtools/transport/segments.js", this);
loader.loadSubScript(
  "resource://gre/modules/devtools/transport/packets.js", this);

/**
 * An adapter that handles data transfers between the debugger client and
 * server. It can work with both nsIPipe and nsIServerSocket transports so
 * long as the properly created input and output streams are specified.
 * (However, for intra-process connections, LocalDebuggerTransport, below,
 * is more efficient than using an nsIPipe pair with DebuggerTransport.)
 *
 * @param input nsIAsyncInputStream
 *        The input stream.
 * @param output nsIAsyncOutputStream
 *        The output stream.
 *
 * Given a DebuggerTransport instance dt:
 * 1) Set dt.hooks to a packet handler object (described below).
 * 2) Call dt.ready() to begin watching for input packets.
 * 3) Call dt.send() / dt.startBulkSend() to send packets.
 * 4) Call dt.close() to close the connection, and disengage from the event
 *    loop.
 *
 * A packet handler is an object with the following methods:
 *
 * - onPacket(packet) - called when we have received a complete packet.
 *   |packet| is the parsed form of the packet --- a JavaScript value, not
 *   a JSON-syntax string.
 *
 * - onBulkPacket(packet) - called when we have switched to bulk packet
 *   receiving mode. |packet| is an object containing:
 *   * actor:  Actor that will receive the packet
 *   * type:   Method of the actor that should be called on receipt
 *   * length: Size of the data to be read
 *   * stream: This input stream should only be used directly if you can ensure
 *             that you will read exactly |length| bytes and will not close the
 *             stream when writing is complete
 *   * done:   If you use the stream directly (instead of |copyTo| below), you
 *             must signal completion by resolving / rejecting this deferred.
 *             If you do use |copyTo|, this is taken care of for you when
 *             copying completes.
 *   * copyTo: A helper function for getting your data out of the stream that
 *             meets the stream handling requirements above, and has the
 *             following signature:
 *     @param  output nsIAsyncOutputStream
 *             The stream to copy to.
 *     @return Promise
 *             The promise is resolved when copying completes or rejected if any
 *             (unexpected) errors occur.
 *
 * - onClosed(reason) - called when the connection is closed. |reason| is
 *   an optional nsresult or object, typically passed when the transport is
 *   closed due to some error in a underlying stream.
 *
 * See ./packets.js and the Remote Debugging Protocol specification for more
 * details on the format of these packets.
 */
this.DebuggerTransport = function DebuggerTransport(input, output) {
  this._input = input;
  this._output = output;

  // The current incoming Packet object
  this._incoming = null;
  // A queue of outgoing Packet objects
  this._outgoing = [];

  this.hooks = null;
  this.active = false;

  this._incomingEnabled = true;
  this._outgoingEnabled = true;

  this.close = this.close.bind(this);
};

DebuggerTransport.prototype = {
  /**
   * Transmit an object as a JSON packet.
   *
   * This method returns immediately, without waiting for the entire
   * packet to be transmitted, registering event handlers as needed to
   * transmit the entire packet. Packets are transmitted in the order
   * they are passed to this method.
   */
  send: function(object) {
    let packet = new JSONPacket(this);
    packet.object = object;
    this._outgoing.push(packet);
    this._flushOutgoing();
  },

  /**
   * Transmit streaming data via a bulk packet.
   *
   * This method initiates the bulk send process by queuing up the header data.
   * The caller receives eventual access to a stream for writing.
   *
   * N.B.: Do *not* attempt to close the stream handed to you, as it will
   * continue to be used by this transport afterwards.  Most users should
   * instead use the provided |copyFrom| function instead.
   *
   * @param header Object
   *        This is modeled after the format of JSON packets above, but does not
   *        actually contain the data, but is instead just a routing header:
   *          * actor:  Actor that will receive the packet
   *          * type:   Method of the actor that should be called on receipt
   *          * length: Size of the data to be sent
   * @return Promise
   *         The promise will be resolved when you are allowed to write to the
   *         stream with an object containing:
   *           * stream:   This output stream should only be used directly if
   *                       you can ensure that you will write exactly |length|
   *                       bytes and will not close the stream when writing is
   *                       complete
   *           * done:     If you use the stream directly (instead of |copyFrom|
   *                       below), you must signal completion by resolving /
   *                       rejecting this deferred.  If you do use |copyFrom|,
   *                       this is taken care of for you when copying completes.
   *           * copyFrom: A helper function for getting your data onto the
   *                       stream that meets the stream handling requirements
   *                       above, and has the following signature:
   *             @param  input nsIAsyncInputStream
   *                     The stream to copy from.
   *             @return Promise
   *                     The promise is resolved when copying completes or
   *                     rejected if any (unexpected) errors occur.
   */
  startBulkSend: function(header) {
    let packet = new BulkPacket(this);
    packet.header = header;
    this._outgoing.push(packet);
    this._flushOutgoing();
    return packet.streamReadyForWriting;
  },

  /**
   * Close the transport.
   * @param reason nsresult / object (optional)
   *        The status code or error message that corresponds to the reason for
   *        closing the transport (likely because a stream closed or failed).
   */
  close: function(reason) {
    this.active = false;
    this._input.close();
    this._output.close();
    this._destroyIncoming();
    this._destroyAllOutgoing();
    if (this.hooks) {
      this.hooks.onClosed(reason);
      this.hooks = null;
    }
    if (reason) {
      dumpn("Transport closed: " + JSON.stringify(reason, null, 2));
    } else {
      dumpn("Transport closed.");
    }
  },

  /**
   * The currently outgoing packet (at the top of the queue).
   */
  get _currentOutgoing() { return this._outgoing[0]; },

  /**
   * Flush data to the outgoing stream.  Waits until the output stream notifies
   * us that it is ready to be written to (via onOutputStreamReady).
   */
  _flushOutgoing: function() {
    if (!this._outgoingEnabled || this._outgoing.length === 0) {
      return;
    }

    // If the top of the packet queue has nothing more to send, remove it.
    if (this._currentOutgoing.done) {
      this._finishCurrentOutgoing();
    }

    if (this._outgoing.length > 0) {
      var threadManager = Cc["@mozilla.org/thread-manager;1"].getService();
      this._output.asyncWait(this, 0, 0, threadManager.currentThread);
    }
  },

  /**
   * Pause this transport's attempts to write to the output stream.  This is
   * used when we've temporarily handed off our output stream for writing bulk
   * data.
   */
  pauseOutgoing: function() {
    this._outgoingEnabled = false;
  },

  /**
   * Resume this transport's attempts to write to the output stream.
   */
  resumeOutgoing: function() {
    this._outgoingEnabled = true;
    this._flushOutgoing();
  },

  // nsIOutputStreamCallback
  /**
   * This is called when the output stream is ready for more data to be written.
   * The current outgoing packet will attempt to write some amount of data, but
   * may not complete.
   */
  onOutputStreamReady: DevToolsUtils.makeInfallible(function(stream) {
    if (this._outgoing.length === 0) {
      return;
    }

    try {
      this._currentOutgoing.write(stream);
    } catch(e if e.result == Cr.NS_BASE_STREAM_CLOSED ||
                 e.result == Cr.NS_ERROR_NET_RESET) {
      this.close(e.result);
      return;
    }

    this._flushOutgoing();
  }, "DebuggerTransport.prototype.onOutputStreamReady"),

  /**
   * Remove the current outgoing packet from the queue upon completion.
   */
  _finishCurrentOutgoing: function() {
    if (this._currentOutgoing) {
      this._currentOutgoing.destroy();
      this._outgoing.shift();
    }
  },

  /**
   * Clear the entire outgoing queue.
   */
  _destroyAllOutgoing: function() {
    for (let packet of this._outgoing) {
      packet.destroy();
    }
    this._outgoing = [];
  },

  /**
   * Initialize the input stream for reading. Once this method has been called,
   * we watch for packets on the input stream, and pass them to the appropriate
   * handlers via this.hooks.
   */
  ready: function() {
    this.active = true;
    this._waitForIncoming();
  },

  /**
   * Asks the input stream to notify us (via onInputStreamReady) when it is
   * ready for reading.
   */
  _waitForIncoming: function() {
    if (this._incomingEnabled) {
      let threadManager = Cc["@mozilla.org/thread-manager;1"].getService();
      this._input.asyncWait(this, 0, 0, threadManager.currentThread);
    }
  },

  /**
   * Pause this transport's attempts to read from the input stream.  This is
   * used when we've temporarily handed off our input stream for reading bulk
   * data.
   */
  pauseIncoming: function() {
    this._incomingEnabled = false;
  },

  /**
   * Resume this transport's attempts to read from the input stream.
   */
  resumeIncoming: function() {
    this._incomingEnabled = true;
    this._flushIncoming();
    this._waitForIncoming();
  },

  // nsIInputStreamCallback
  /**
   * Called when the stream is either readable or closed.
   */
  onInputStreamReady:
  DevToolsUtils.makeInfallible(function(stream) {
    try {
      while(stream.available() && this._incomingEnabled &&
            this._processIncoming(stream, stream.available())) {}
      this._waitForIncoming();
    } catch(e if e.result == Cr.NS_BASE_STREAM_CLOSED ||
                 e.result == Cr.NS_ERROR_CONNECTION_REFUSED ||
                 e.result == Cr.NS_ERROR_OFFLINE) {
      this.close(e.result);
    }
  }, "DebuggerTransport.prototype.onInputStreamReady"),

  /**
   * Process the incoming data.  Will create a new currently incoming Packet if
   * needed.  Tells the incoming Packet to read as much data as it can, but
   * reading may not complete.  The Packet signals that its data is ready for
   * delivery by calling one of this transport's _on*Ready methods (see
   * ./packets.js and the _on*Ready methods below).
   * @return boolean
   *         Whether incoming stream processing should continue for any
   *         remaining data.
   */
  _processIncoming: function(stream, count) {
    dumpv(() => "data available: " + count);

    if (!count) {
      dumpv(() => "Nothing to read, skipping");
      return false;
    }

    if (!this._incoming) {
      dumpv(() => "Creating a new packet from incoming");
      if (count < 4) {
        return false; // Not enough data to read packet type
      }
      let packetType = NetUtil.readInputStreamToString(stream, 4);
      this._createIncoming(packetType);
    }

    try {
      if (!this._incoming.done) {
        // We have an incomplete packet, keep reading it.
        dumpv(() => "Existing packet incomplete, keep reading");
        this._incoming.read(stream);
      }
    } catch(e) {
      let msg = "Error reading incoming packet: (" + e + " - " + e.stack + ")";
      dumpn(msg);

      // Now in an invalid state, shut down the transport.
      this.close();
      return false;
    }

    if (!this._incoming.done) {
      // Still not complete, we'll wait for more data.
      dumpv(() => "Packet not done, wait for more");
      return true;
    }

    // Ready for next packet
    this._flushIncoming();
    return true;
  },

  /**
   * If the incoming packet is done, log it as needed and clear the buffer.
   */
  _flushIncoming: function() {
    if (!this._incoming.done) {
      return;
    }
    if (wantLogging) {
      dumpn("Got: " + this._incoming);
    }
    this._destroyIncoming();
  },

  /**
   * Handler triggered by an incoming JSONPacket completing it's |read| method.
   * Delivers the packet to this.hooks.onPacket.
   */
  _onJSONObjectReady: function(object) {
    Services.tm.currentThread.dispatch(DevToolsUtils.makeInfallible(() => {
      // Ensure the transport is still alive by the time this runs.
      if (this.active) {
        this.hooks.onPacket(object);
      }
    }, "DebuggerTransport instance's this.hooks.onPacket"), 0);
  },

  /**
   * Handler triggered by an incoming BulkPacket entering the |read| phase for
   * the stream portion of the packet.  Delivers info about the incoming
   * streaming data to this.hooks.onBulkPacket.  See the main comment on the
   * transport at the top of this file for more details.
   */
  _onBulkReadReady: function(...args) {
    Services.tm.currentThread.dispatch(DevToolsUtils.makeInfallible(() => {
      // Ensure the transport is still alive by the time this runs.
      if (this.active) {
        this.hooks.onBulkPacket(...args);
      }
    }, "DebuggerTransport instance's this.hooks.onBulkPacket"), 0);
  },

  /**
   * Create a new incoming Packet based on the packet "type", which is derived
   * from the first few bytes coming in.
   */
  _createIncoming: function(packetType) {
    this._incoming = packetFactory.fromType(packetType, this);
  },

  /**
   * Remove all handlers and references related to the current incoming packet,
   * either because it is now complete or because the transport is closing.
   */
  _destroyIncoming: function() {
    if (this._incoming) {
      this._incoming.destroy();
    }
    this._incoming = null;
  }

};


/**
 * An adapter that handles data transfers between the debugger client and
 * server when they both run in the same process. It presents the same API as
 * DebuggerTransport, but instead of transmitting serialized messages across a
 * connection it merely calls the packet dispatcher of the other side.
 *
 * @param aOther LocalDebuggerTransport
 *        The other endpoint for this debugger connection.
 *
 * @see DebuggerTransport
 */
this.LocalDebuggerTransport = function LocalDebuggerTransport(aOther)
{
  this.other = aOther;
  this.hooks = null;

  /*
   * A packet number, shared between this and this.other. This isn't used
   * by the protocol at all, but it makes the packet traces a lot easier to
   * follow.
   */
  this._serial = this.other ? this.other._serial : { count: 0 };
  this.close = this.close.bind(this);
}

LocalDebuggerTransport.prototype = {
  /**
   * Transmit a message by directly calling the onPacket handler of the other
   * endpoint.
   */
  send: function(aPacket) {
    let serial = this._serial.count++;
    if (wantLogging) {
      /* Check 'from' first, as 'echo' packets have both. */
      if (aPacket.from) {
        dumpn("Packet " + serial + " sent from " + uneval(aPacket.from));
      } else if (aPacket.to) {
        dumpn("Packet " + serial + " sent to " + uneval(aPacket.to));
      }
    }
    this._deepFreeze(aPacket);
    let other = this.other;
    if (other) {
      Services.tm.currentThread.dispatch(DevToolsUtils.makeInfallible(() => {
        // Avoid the cost of JSON.stringify() when logging is disabled.
        if (wantLogging) {
          dumpn("Received packet " + serial + ": " + JSON.stringify(aPacket, null, 2));
        }
        if (other.hooks) {
          other.hooks.onPacket(aPacket);
        }
      }, "LocalDebuggerTransport instance's this.other.hooks.onPacket"), 0);
    }
  },

  /**
   * Send a streaming bulk packet directly to the onBulkPacket handler of the
   * other endpoint.
   *
   * This case is much simpler than the full DebuggerTransport, since there is
   * no primary stream we have to worry about managing while we hand it off to
   * others temporarily.  Instead, we can just make a single use pipe and be
   * done with it.
   */
  startBulkSend: function({actor, type, length}) {
    let serial = this._serial.count++;

    dumpn("Sent bulk packet " + serial + " for actor " + actor);
    if (!this.other) {
      return;
    }

    let pipe = new Pipe(true, true, 0, 0, null);

    Services.tm.currentThread.dispatch(DevToolsUtils.makeInfallible(() => {
      dumpn("Received bulk packet " + serial);
      if (!this.other.hooks) {
        return;
      }

      // Receiver
      let deferred = defer();

      this.other.hooks.onBulkPacket({
        actor: actor,
        type: type,
        length: length,
        copyTo: (output) => {
          deferred.resolve(copyStream(pipe.inputStream, output, length));
          return deferred.promise;
        },
        stream: pipe.inputStream,
        done: deferred
      });

      // Await the result of reading from the stream
      deferred.promise.then(() => pipe.inputStream.close(), this.close);
    }, "LocalDebuggerTransport instance's this.other.hooks.onBulkPacket"), 0);

    // Sender
    let sendDeferred = defer();

    // The remote transport is not capable of resolving immediately here, so we
    // shouldn't be able to either.
    Services.tm.currentThread.dispatch(() => {
      let copyDeferred = defer();

      sendDeferred.resolve({
        copyFrom: (input) => {
          copyDeferred.resolve(copyStream(input, pipe.outputStream, length));
          return copyDeferred.promise;
        },
        stream: pipe.outputStream,
        done: copyDeferred
      });

      // Await the result of writing to the stream
      copyDeferred.promise.then(() => pipe.outputStream.close(), this.close);
    }, 0);

    return sendDeferred.promise;
  },

  /**
   * Close the transport.
   */
  close: function() {
    if (this.other) {
      // Remove the reference to the other endpoint before calling close(), to
      // avoid infinite recursion.
      let other = this.other;
      this.other = null;
      other.close();
    }
    if (this.hooks) {
      try {
        this.hooks.onClosed();
      } catch(ex) {
        Components.utils.reportError(ex);
      }
      this.hooks = null;
    }
  },

  /**
   * An empty method for emulating the DebuggerTransport API.
   */
  ready: function() {},

  /**
   * Helper function that makes an object fully immutable.
   */
  _deepFreeze: function(aObject) {
    Object.freeze(aObject);
    for (let prop in aObject) {
      // Freeze the properties that are objects, not on the prototype, and not
      // already frozen. Note that this might leave an unfrozen reference
      // somewhere in the object if there is an already frozen object containing
      // an unfrozen object.
      if (aObject.hasOwnProperty(prop) && typeof aObject === "object" &&
          !Object.isFrozen(aObject)) {
        this._deepFreeze(o[prop]);
      }
    }
  }
};

/**
 * A transport for the debugging protocol that uses nsIMessageSenders to
 * exchange packets with servers running in child processes.
 *
 * In the parent process, |aSender| should be the nsIMessageSender for the
 * child process. In a child process, |aSender| should be the child process
 * message manager, which sends packets to the parent.
 *
 * aPrefix is a string included in the message names, to distinguish
 * multiple servers running in the same child process.
 *
 * This transport exchanges messages named 'debug:<prefix>:packet', where
 * <prefix> is |aPrefix|, whose data is the protocol packet.
 */
function ChildDebuggerTransport(aSender, aPrefix) {
  this._sender = aSender.QueryInterface(Components.interfaces.nsIMessageSender);
  this._messageName = "debug:" + aPrefix + ":packet";
}

/*
 * To avoid confusion, we use 'message' to mean something that
 * nsIMessageSender conveys, and 'packet' to mean a remote debugging
 * protocol packet.
 */
ChildDebuggerTransport.prototype = {
  constructor: ChildDebuggerTransport,

  hooks: null,

  ready: function () {
    this._sender.addMessageListener(this._messageName, this);
  },

  close: function () {
    this._sender.removeMessageListener(this._messageName, this);
    this.hooks.onClosed();
  },

  receiveMessage: function ({data}) {
    this.hooks.onPacket(data);
  },

  send: function (packet) {
    this._sender.sendAsyncMessage(this._messageName, packet);
  },

  startBulkSend: function() {
    throw new Error("Can't send bulk data to child processes.");
  }
};
