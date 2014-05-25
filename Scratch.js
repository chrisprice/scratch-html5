!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.Scratch=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// IO.js
// Tim Mickel, March 2012

// IO handles JSON communication and processing.
// We make the sprites and threads here.

'use strict';

var Instr = _dereq_('../soundbank/Instr'),
    WAVFile = _dereq_('./sound/WAVFile'),
    SoundDecoder = _dereq_('./sound/SoundDecoder'),
    Stage = _dereq_('./Stage'),
    Sprite = _dereq_('./Sprite'),
    OffsetBuffer = _dereq_('./util/OffsetBuffer');

var IO = function() {
    this.data = null;
    // In production, simply use the local path (no proxy)
    // since we won't be hampered by the same-origin policy.
    this.base = 'proxy.php?resource=internalapi/';
    //this.base = 'http://scratch.mit.edu/internalapi/'; // Final base
    this.project_base = 'http://projects.scratch.mit.edu/internalapi/project/';
    this.project_suffix = '/get/';
    this.asset_base = 'http://cdn.scratch.mit.edu/internalapi/asset/';
    this.asset_suffix = '/get/';
    this.soundbank_base = 'soundbank/';
    this.spriteLayerCount = 0;
};

IO.prototype.loadProject = function(project_id) {
    var self = this;
    $.getJSON(this.project_base + project_id + this.project_suffix, function(data) {
        self.data = data;
        self.makeObjects();
        self.loadThreads();
        self.loadNotesDrums();
        runtime.loadStart(); // Try to run the project.
    });
};

IO.prototype.soundRequest = function(sound, sprite) {
    var request = new XMLHttpRequest();
    request.open('GET', this.asset_base + sound['md5'] + this.asset_suffix, true);
    request.responseType = 'arraybuffer';
    request.onload = function() {
        var waveData = request.response;
        // Decode the waveData and populate a buffer channel with the samples
        var snd = new SoundDecoder(waveData);
        var samples = snd.getAllSamples();
        sound.buffer = runtime.audioContext.createBuffer(1, samples.length, runtime.audioContext.sampleRate);
        var data = sound.buffer.getChannelData(0);
        for (var i = 0; i < data.length; i++) {
            data[i] = samples[i];
        }
        sprite.soundsLoaded++;
    };
    request.send();
};

IO.prototype.loadNotesDrums = function() {
    var self = this;
    $.each(Instr.wavs, function(name, file) {
        var request = new XMLHttpRequest();
        request.open('GET', self.soundbank_base + escape(file), true);
        request.responseType = 'arraybuffer';
        request.onload = function() {
            var waveData = new OffsetBuffer(request.response);
            // Decode the waveData and populate a buffer channel with the samples
            var info = WAVFile.decode(request.response);
            waveData.offset = info.sampleDataStart;
            var soundBuffer = waveData.readBytes(2 * info.sampleCount);
            Instr.samples[name] = soundBuffer;
            Instr.wavsLoaded++;
        };
        request.send();
    });
};

IO.prototype.makeObjects = function() {
    // Create the stage
    runtime.stage = new Stage(this.data);
    runtime.stage.attach(runtime.scene);
    runtime.stage.attachPenLayer(runtime.scene);
    runtime.stage.loadSounds();
    // Create the sprites and watchers
    function createObj(obj, sprite) {
        var newSprite;
        function createSprite(obj) {
            var newSprite = new Sprite(obj);
            newSprite.loadSounds();
            return newSprite;
        }
        function createReporter(obj, sprite) {
            var newSprite;
            if (obj.listName) { // list
                if (!(sprite===runtime.stage && !runtime.stage.lists[obj.listName])) { // for local lists, only if in sprite
                    newSprite = new List(obj, sprite.objName);
                    runtime.reporters.push(newSprite);
                }
            } else {
                newSprite = new Reporter(obj);
                runtime.reporters.push(newSprite);
            }
            return newSprite;
        }
        if (obj.objName) { // sprite
            newSprite = createSprite(obj);
            sprite = newSprite;
        } else {
            newSprite = createReporter(obj, sprite);
        }
        if (newSprite) {
            runtime.sprites.push(newSprite);
            newSprite.attach(runtime.scene);
        }
    }
    $.each(this.data.children, function(index, obj) {
        createObj(obj, runtime.stage); // create children of stage - sprites, watchers, and stage's lists
    });
    $.each(runtime.sprites.filter(function(sprite) {return sprite instanceof Sprite}), function(index, sprite) { // list of sprites
        $.each(sprite.lists, function(index, list) {
            createObj(list, sprite); // create local lists
        });
    });
};

IO.prototype.loadThreads = function() {
    var target = runtime.stage;
    var scripts = target.data.scripts;
    if (scripts) {
        for (var s in scripts) {
            target.stacks.push(interp.makeBlockList(scripts[s][2]));
        }
    }
    $.each(this.data.children, function(index, obj) {
        target = runtime.sprites[index];
        if (typeof(target) != 'undefined' && target.data && target.data.scripts) {
            $.each(target.data.scripts, function(j, s) {
                target.stacks.push(interp.makeBlockList(s[2]));
            });
        }
    });
};

// Returns the number sprite we are rendering
// used for initial layering assignment
IO.prototype.getCount = function() {
    var rv = this.spriteLayerCount;
    this.spriteLayerCount++;
    return rv;
};

module.exports = IO;

},{"../soundbank/Instr":19,"./Sprite":5,"./Stage":6,"./sound/SoundDecoder":13,"./sound/WAVFile":14,"./util/OffsetBuffer":16}],2:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// Interpreter.js
// Tim Mickel, July 2011
// Based on the original by John Maloney

'use strict';

var Primitives = _dereq_('./primitives/Primitives'),
    Timer = _dereq_('./util/Timer');

var Block = function(opAndArgs, optionalSubstack) {
    this.op = opAndArgs[0];
    this.primFcn = interp.lookupPrim(this.op);
    this.args = opAndArgs.slice(1); // arguments can be either or constants (numbers, boolean strings, etc.) or expressions (Blocks)
    this.isLoop = false; // set to true for loop blocks the first time they run
    this.substack = optionalSubstack;
    this.subStack2 = null;
    this.nextBlock = null;
    this.tmp = -1;
    interp.fixArgs(this);
};

var Thread = function(block, target) {
    this.nextBlock = block; // next block to run; null when thread is finished
    this.firstBlock = block;
    this.stack = []; // stack of enclosing control structure blocks
    this.target = target; // target object running the thread
    this.tmp = null; // used for thread operations like Timer
    this.tmpObj = []; // used for Sprite operations like glide
    this.firstTime = true;
    this.paused = false;
};

var Interpreter = function() {
    // Interpreter state
    this.primitiveTable = {}
    this.variables = {};
    this.threads = [];
    this.activeThread = new Thread(null);
    this.WorkTime = 30;
    this.currentMSecs = null;
    this.timer = new Timer();
    this.yield = false;
    this.doRedraw = false;
    this.opCount = 0; // used to benchmark the interpreter
    this.debugOps = false;
    this.debugFunc = null;
    this.opCount2 = 0;
};

// Utilities for building blocks and sequences of blocks
Interpreter.prototype.fixArgs = function(b) {
    // Convert the arguments of the given block into blocks or substacks if necessary.
    // A block argument can be a constant (numbers, boolean strings, etc.), an expression (Blocks), or a substack (an array of blocks).
    var newArgs = [];
    for (var i = 0; i < b.args.length; i++) {
        var arg = b.args[i];
        if (arg && arg.constructor == Array) {
            if ((arg.length > 0) && (arg[0].constructor == Array)) {
                // if first element arg is itself an array, then arg is a substack
                if (!b.substack) {
                    b.substack = this.makeBlockList(arg);
                } else {
                    b.substack2 = this.makeBlockList(arg);
                }
            } else {
                // arg is a block
                newArgs.push(new Block(arg));
            }
        } else {
            newArgs.push(arg); // arg is a constant
        }
    }
    b.args = newArgs;
};

Interpreter.prototype.makeBlockList = function(blockList) {
    var firstBlock = null, lastBlock = null;
    for (var i = 0; i < blockList.length; i++) {
        var b = new Block(blockList[i]);
        if (firstBlock == null) firstBlock = b;
        if (lastBlock) lastBlock.nextBlock = b;
        lastBlock = b;
    }
    return firstBlock;
};

// The Interpreter proper
Interpreter.prototype.stepThreads = function() {
    var startTime;
    startTime = this.currentMSecs = this.timer.time();
    this.doRedraw = false;
    if (this.threads.length == 0) return;

    while ((this.currentMSecs - startTime) < this.WorkTime && !this.doRedraw) {
        var threadStopped = false;
        for (var a = this.threads.length-1; a >= 0; --a) {
            this.activeThread = this.threads[a];
            this.stepActiveThread();
            if (!this.activeThread || this.activeThread.nextBlock == null) {
                threadStopped = true;
            }
        }
        if (threadStopped) {
            var newThreads = [];
            for (var a = this.threads.length-1; a >= 0; --a) {
                if (this.threads[a].nextBlock != null) {
                    newThreads.push(this.threads[a]);
                }
            }
            this.threads = newThreads;
            if (this.threads.length == 0) return;
        }
        this.currentMSecs = this.timer.time();
    }
};

Interpreter.prototype.stepActiveThread = function() {
    // Run the active thread until it yields.
    if (typeof(this.activeThread) == 'undefined') {
        return;
    }
    var b = this.activeThread.nextBlock;
    if (b == null) return;
    this.yield = false;
    while (true) {
        if (this.activeThread.paused) return;

        ++this.opCount;
        // Advance the "program counter" to the next block before running the primitive.
        // Control flow primitives (e.g. if) may change activeThread.nextBlock.
        this.activeThread.nextBlock = b.nextBlock;
        if (this.debugOps && this.debugFunc) {
            var finalArgs = [];
            for (var i = 0; i < b.args.length; ++i) {
                finalArgs.push(this.arg(b, i));
            }

            this.debugFunc(this.opCount2, b.op, finalArgs);
            ++this.opCount2;
        }
        b.primFcn(b);
        if (this.yield) { this.activeThread.nextBlock = b; return; }
        b = this.activeThread.nextBlock; // refresh local variable b in case primitive did some control flow
        while (!b) {
            // end of a substack; pop the owning control flow block from stack
            // Note: This is a loop to handle nested control flow blocks.

            // yield at the end of a loop or when stack is empty
            if (this.activeThread.stack.length === 0) {
                this.activeThread.nextBlock = null;
                return;
            } else {
                b = this.activeThread.stack.pop();
                if (b.isLoop) {
                    this.activeThread.nextBlock = b; // preserve where it left off
                    return;
                } else {
                    b = b.nextBlock; // skip and continue for non looping blocks
                }
            }
        }
    }
};

Interpreter.prototype.toggleThread = function(b, targetObj) {
    var newThreads = [], wasRunning = false;
    for (var i = 0; i < this.threads.length; i++) {
        if (this.threads[i].stack[0] == b) {
            wasRunning = true;
        } else {
            newThreads.push(this.threads[i]);
        }
    }
    this.threads = newThreads;
    if (!wasRunning) {
        this.startThread(b, targetObj);
    }
}

Interpreter.prototype.startThread = function(b, targetObj) {
    this.activeThread = new Thread(b, targetObj);
    this.threads.push(this.activeThread);
};

Interpreter.prototype.restartThread = function(b, targetObj) {
    // used by broadcast; stop any thread running on b, then start a new thread on b
    var newThread = new Thread(b, targetObj);
    var wasRunning = false;
    for (var i = 0; i < this.threads.length; i++) {
        if (this.threads[i].stack[0] == b) {
            this.threads[i] = newThread;
            wasRunning = true;
        }
    }
    if (!wasRunning) {
        this.threads.push(newThread);
    }
};

Interpreter.prototype.arg = function(block, index) {
    var arg = block.args[index];
    if ((typeof(arg) == 'object') && (arg.constructor == Block)) {
        ++this.opCount;
        if (this.debugOps && this.debugFunc) {
            var finalArgs = [];
            for (var i = 0; i < arg.args.length; ++i) {
                finalArgs.push(this.arg(arg, i));
            }

            this.debugFunc(this.opCount2, arg.op, finalArgs);
            ++this.opCount2;
        }
        return arg.primFcn(arg); // expression
    }
    return arg;
};

Interpreter.prototype.numarg = function(block, index) {
    var arg = Number(this.arg(block, index));
    if (arg !== arg) {
        return 0;
    }
    return arg;
};

Interpreter.prototype.boolarg = function(block, index) {
    var arg = this.arg(block, index);
    if (typeof arg === 'boolean') {
        return arg;
    } else if (typeof arg === 'string') {
        return !(arg === '' || arg === '0' || arg.toLowerCase() === 'false');
    }
    return Boolean(arg);
};

Interpreter.prototype.targetSprite = function() {
    return this.activeThread.target;
};

Interpreter.prototype.targetStage = function() {
    return runtime.stage;
};

// Timer
Interpreter.prototype.startTimer = function(secs) {
    var waitMSecs = 1000 * secs;
    if (waitMSecs < 0) waitMSecs = 0;
    this.activeThread.tmp = this.currentMSecs + waitMSecs; // end time in milliseconds
    this.activeThread.firstTime = false;
    this.yield = true;
};

Interpreter.prototype.checkTimer = function() {
    // check for timer expiration and clean up if expired. return true when expired
    if (this.currentMSecs >= this.activeThread.tmp) {
        // time expired
        this.activeThread.tmp = 0;
        this.activeThread.firstTime = true;
        return true;
    } else {
        this.yield = true;
        return false;
    }
};

Interpreter.prototype.redraw = function() {
    this.doRedraw = true;
};

// Primitive operations
Interpreter.prototype.initPrims = function() {
    this.primitiveTable = {};
    this.primitiveTable['whenGreenFlag']       = this.primNoop;
    this.primitiveTable['whenKeyPressed']      = this.primNoop;
    this.primitiveTable['whenClicked']         = this.primNoop;
    this.primitiveTable['if']                  = function(b) { if (interp.boolarg(b, 0)) interp.startSubstack(b); };
    this.primitiveTable['doForever']           = function(b) { interp.startSubstack(b, true); };
    this.primitiveTable['doForeverIf']         = function(b) { if (interp.boolarg(b, 0)) interp.startSubstack(b, true); else interp.yield = true; };
    this.primitiveTable['doIf']                = function(b) { if (interp.boolarg(b, 0)) interp.startSubstack(b); };
    this.primitiveTable['doRepeat']            = this.primRepeat;
    this.primitiveTable['doIfElse']            = function(b) { if (interp.boolarg(b, 0)) interp.startSubstack(b); else interp.startSubstack(b, false, true); };
    this.primitiveTable['doWaitUntil']         = function(b) { if (!interp.boolarg(b, 0)) interp.yield = true; };
    this.primitiveTable['doUntil']             = function(b) { if (!interp.boolarg(b, 0)) interp.startSubstack(b, true); };
    this.primitiveTable['doReturn']            = function(b) { interp.activeThread = new Thread(null); };
    this.primitiveTable['stopAll']             = function(b) { interp.activeThread = new Thread(null); interp.threads = []; }
    this.primitiveTable['whenIReceive']        = this.primNoop;
    this.primitiveTable['broadcast:']          = function(b) { interp.broadcast(b, false); };
    this.primitiveTable['doBroadcastAndWait']  = function(b) { interp.broadcast(b, true); };
    this.primitiveTable['wait:elapsed:from:']  = this.primWait;

    // added by John:
    this.primitiveTable['showBubble'] = function(b) { console.log(interp.arg(b, 1)); };
    this.primitiveTable['timerReset'] = function(b) { interp.timerBase = Date.now(); };
    this.primitiveTable['timer'] = function(b) { return (Date.now() - interp.timerBase) / 1000; };

    new Primitives().addPrimsTo(this.primitiveTable);
};

Interpreter.prototype.timerBase = Date.now();
Interpreter.prototype.lookupPrim = function(op) {
    var fcn = interp.primitiveTable[op];
    if (fcn == null) fcn = function(b) { console.log('not implemented: ' + b.op); };
    return fcn;
};

Interpreter.prototype.primNoop = function(b) { console.log(b.op); };

Interpreter.prototype.primWait = function(b) {
    if (interp.activeThread.firstTime) {
        interp.startTimer(interp.numarg(b, 0));
    } else {
        interp.checkTimer();
    }
};

Interpreter.prototype.primRepeat = function(b) {
    if (b.tmp == -1) {
        b.tmp = Math.max(interp.numarg(b, 0), 0); // Initialize repeat count on this block
    }
    if (b.tmp > 0) {
        b.tmp -= 1; // decrement count
        interp.startSubstack(b, true);
    } else {
        // Done executing this repeat block for this round
        b.tmp = -1;
        b = null;
    }
};

Interpreter.prototype.broadcast = function(b, waitFlag) {
    var pair;
    if (interp.activeThread.firstTime) {
        var receivers = [];
        var msg = String(interp.arg(b, 0)).toLowerCase();
        var findReceivers = function(stack, target) {
            if ((stack.op == 'whenIReceive') && (stack.args[0].toLowerCase() == msg)) {
                receivers.push([stack, target]);
            }
        }
        runtime.allStacksDo(findReceivers);
        for (pair in receivers) {
            interp.restartThread(receivers[pair][0], receivers[pair][1]);
        }
        if (!waitFlag) return;
        interp.activeThread.tmpObj = receivers;
        interp.activeThread.firstTime = false;
    }
    var done = true;
    for (pair in interp.activeThread.tmpObj) {
        if (interp.isRunning(interp.activeThread.tmpObj[pair][0])) {
            done = false;
        }
    }
    if (done) {
        interp.activeThread.tmpObj = null;
        interp.activeThread.firstTime = true;
    } else {
        interp.yield = true;
    }
};

Interpreter.prototype.isRunning = function(b) {
    for (var t in interp.threads) {
        if (interp.threads[t].firstBlock == b) {
            return true;
        }
    }
    return false;
};

Interpreter.prototype.startSubstack = function(b, isLoop, secondSubstack) {
    // Start the substack of a control structure command such as if or forever.
    b.isLoop = !!isLoop;
    this.activeThread.stack.push(b); // remember the block that started the substack
    if (!secondSubstack) {
        this.activeThread.nextBlock = b.substack;
    } else {
        this.activeThread.nextBlock = b.substack2;
    }
};

module.exports = Interpreter;
module.exports.Thread = Thread;
module.exports.Block = Block;

},{"./primitives/Primitives":9,"./util/Timer":18}],3:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// Runtime.js
// Tim Mickel, July 2011

// Runtime takes care of the rendering and stepping logic.

'use strict';

var Thread = _dereq_('./Interpreter').Thread,
    SoundPrims = _dereq_('./primitives/SoundPrims'),
    Instr = _dereq_('../soundbank/Instr'),
    Sprite = _dereq_('./Sprite'),
    Timer = _dereq_('./util/Timer');

var t = new Timer();

var Runtime = function() {
    this.scene = null;
    this.sprites = [];
    this.reporters = [];
    this.keysDown = {};
    this.mouseDown = false;
    this.mousePos = [0, 0];
    this.audioContext = null;
    this.audioGain = null;
    this.audioPlaying = [];
    this.notesPlaying = [];
    this.projectLoaded = false;
};

// Initializer for the drawing and audio contexts.
Runtime.prototype.init = function() {
    this.scene = $('#container');
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContext();
    try {
        this.audioGain = this.audioContext.createGain();
    } catch(err) {
        this.audioGain = this.audioContext.createGainNode();
    }
    this.audioGain.connect(runtime.audioContext.destination);
};

// Load start waits for the stage and the sprites to be loaded, without
// hanging the browser.  When the loading is finished, we begin the step
// and animate methods.
Runtime.prototype.loadStart = function() {
    if (!runtime.stage.isLoaded()) {
        setTimeout(function(runtime) { runtime.loadStart(); }, 50, this);
        return;
    }
    for (var obj = 0; obj < runtime.sprites.length; obj++) {
        if (typeof(runtime.sprites[obj]) == 'object' && runtime.sprites[obj].constructor == Sprite) {
            if (!runtime.sprites[obj].isLoaded()) {
                setTimeout(function(runtime) { runtime.loadStart(); }, 50, this);
                return;
            }
        }
    }
    if (Instr.wavsLoaded != Instr.wavCount) {
        setTimeout(function(runtime) { runtime.loadStart(); }, 50, this);
        return;
    }
    $('#preloader').css('display', 'none');
    setInterval(this.step, 33);
    this.projectLoaded = true;
};

Runtime.prototype.greenFlag = function() {
    if (this.projectLoaded) {
        interp.activeThread = new Thread(null);
        interp.threads = [];
        interp.primitiveTable.timerReset();
        this.startGreenFlags();
    }
};

Runtime.prototype.stopAll = function() {
    interp.activeThread = new Thread(null);
    interp.threads = [];
    SoundPrims.stopAllSounds();
    // Hide sprite bubbles, resetFilters and doAsk prompts
    for (var s = 0; s < runtime.sprites.length; s++) {
        if (runtime.sprites[s].hideBubble) runtime.sprites[s].hideBubble();
        if (runtime.sprites[s].resetFilters) runtime.sprites[s].resetFilters();
        if (runtime.sprites[s].hideAsk) runtime.sprites[s].hideAsk();
    }
    // Reset graphic effects
    runtime.stage.resetFilters();
};

// Step method for execution - called every 33 milliseconds
Runtime.prototype.step = function() {
    interp.stepThreads();
    for (var r = 0; r < runtime.reporters.length; r++) {
        runtime.reporters[r].update();
    }
};

// Stack functions -- push and remove stacks
// to be run by the interpreter as threads.
Runtime.prototype.allStacksDo = function(f) {
    var stage = runtime.stage;
    var stack;
    for (var i = runtime.sprites.length-1; i >= 0; i--) {
        var o = runtime.sprites[i];
        if (typeof(o) == 'object' && o.constructor == Sprite) {
            $.each(o.stacks, function(index, stack) {
                f(stack, o);
            });
        }
    }
    $.each(stage.stacks, function(index, stack) {
        f(stack, stage);
    });
};

// Hat triggers
Runtime.prototype.startGreenFlags = function() {
    function startIfGreenFlag(stack, target) {
        if (stack.op == 'whenGreenFlag') interp.toggleThread(stack, target);
    }
    this.allStacksDo(startIfGreenFlag);
};

Runtime.prototype.startKeyHats = function(ch) {
    var keyName = null;
    if (('A'.charCodeAt(0) <= ch) && (ch <= 'Z'.charCodeAt(0)) ||
        ('a'.charCodeAt(0) <= ch) && (ch <= 'z'.charCodeAt(0)))
        keyName = String.fromCharCode(ch).toLowerCase();
    if (('0'.charCodeAt(0) <= ch) && (ch <= '9'.charCodeAt(0)))
        keyName = String.fromCharCode(ch);

    if (ch == 37) keyName = "left arrow";
    if (ch == 39) keyName = "right arrow";
    if (ch == 38) keyName = "up arrow";
    if (ch == 40) keyName = "down arrow";
    if (ch == 32) keyName = "space";

    if (keyName == null) return;
    var startMatchingKeyHats = function(stack, target) {
        if ((stack.op == "whenKeyPressed") && (stack.args[0] == keyName)) {
            // Only start the stack if it is not already running
            if (!interp.isRunning(stack)) {
                interp.toggleThread(stack, target);
            }
        }
    }
    runtime.allStacksDo(startMatchingKeyHats);
};

Runtime.prototype.startClickedHats = function(sprite) {
    function startIfClicked(stack, target) {
        if (target == sprite && stack.op == "whenClicked" && !interp.isRunning(stack)) {
            interp.toggleThread(stack, target);
        }
    }
    runtime.allStacksDo(startIfClicked);
};

// Returns true if a key is pressed.
Runtime.prototype.keyIsDown = function(ch) {
    return this.keysDown[ch] || false;
};

// Sprite named -- returns one of the sprites on the stage.
Runtime.prototype.spriteNamed = function(n) {
    if (n == 'Stage') return this.stage;
    var selected_sprite = null;
    $.each(this.sprites, function(index, s) {
        if (s.objName == n) {
            selected_sprite = s;
            return false;
        }
    });
    return selected_sprite;
};

Runtime.prototype.getTimeString = function(which) {
    // Return local time properties.
    var now = new Date();
    switch (which) {
        case 'hour': return now.getHours();
        case 'minute': return now.getMinutes();
        case 'second': return now.getSeconds();
        case 'year': return now.getFullYear(); // four digit year (e.g. 2012)
        case 'month': return now.getMonth() + 1; // 1-12
        case 'date': return now.getDate(); // 1-31
        case 'day of week': return now.getDay() + 1; // 1-7, where 1 is Sunday
    }
    return ''; // shouldn't happen
};

// Reassigns z-indices for layer functions
Runtime.prototype.reassignZ = function(target, move) {
    var sprites = this.sprites;
    var oldIndex = -1;
    $.each(this.sprites, function(index, sprite) {
        if (sprite == target) {
            // Splice out the sprite from its old position
            oldIndex = index;
            sprites.splice(index, 1);
        }
    });

    if (move == null) {
        // Move to the front
        this.sprites.splice(this.sprites.length, 0, target);
    } else if (oldIndex - move >= 0 && oldIndex - move < this.sprites.length + 1) {
        // Move to the new position
        this.sprites.splice(oldIndex - move, 0, target);
    } else {
        // No change is required
        this.sprites.splice(oldIndex, 0, target);
    }

    // Renumber the z-indices
    var newZ = 1;
    $.each(this.sprites, function(index, sprite) {
        sprite.z = newZ;
        sprite.updateLayer();
        newZ++;
    });
};

module.exports = Runtime;

},{"../soundbank/Instr":19,"./Interpreter":2,"./Sprite":5,"./primitives/SoundPrims":11,"./util/Timer":18}],4:[function(_dereq_,module,exports){
(function (global){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// Scratch.js
// Tim Mickel, July 2011

// Here we define the actions taken on window load.
// The three application-wide global variables are defined here.

'use strict';

var Interpreter = _dereq_('./Interpreter'),
    Runtime = _dereq_('./Runtime'),
    IO = _dereq_('./IO');

var iosAudioActive = false;
function Scratch(project_id) {
    global.runtime = new Runtime();
    runtime.init();

    $(window).keydown(function(e) {
        runtime.keysDown[e.which] = true;
        runtime.startKeyHats(e.which);
    });

    $(window).keyup(function(e) {
        delete runtime.keysDown[e.which];
    });

    var address = $('#address-hint');
    var project = $('#project-id');

    // Update the project ID field
    project.val(project_id);

    // Validate project ID field
    project.keyup(function() {
        var n = this.value;

        // Allow URL pasting
        var e = /projects\/(\d+)/.exec(n);
        if (e) {
            n = this.value = e[1];
        }

        // Eventually, this will xhr to /projects/{{this.value}}/ and
        // change color based on whether the response is 404 or 200.
        $('#project-id, #address-hint').toggleClass('error', isNaN(n));
    });

    // Focus the actual input when the user clicks on the URL hint
    address.click(function() {
        project.select();
    });

    var width = address.outerWidth();
    project.css({
        paddingLeft: width,
        marginLeft: -width
    });

    // Go project button behavior
    $('#go-project').click(function() {
        window.location = '#' + parseInt($('#project-id').val());
        window.location.reload(true);
    });

    // Green flag behavior
    $('#trigger-green-flag, #overlay').click(function() {
        if (!runtime.projectLoaded) return;
        $('#overlay').css('display', 'none');
        runtime.greenFlag()
    });

    // Stop button behavior
    $('#trigger-stop').click(function() {
        runtime.stopAll();
    });

    // Canvas container mouse events
    $('#container').mousedown(function(e) {
        runtime.mouseDown = true;
        //e.preventDefault();
    });

    $('#container').mouseup(function(e) {
        runtime.mouseDown = false;
        //e.preventDefault();
    });

    $('#container').mousemove(function(e) {
        var bb = this.getBoundingClientRect();
        var absX = e.clientX - bb.left;
        var absY = e.clientY - bb.top;
        runtime.mousePos = [absX-240, -absY+180];
    });

    // Touch events - EXPERIMENTAL
    $(window).bind('touchstart', function(e) {
        // On iOS, we need to activate the Web Audio API
        // with an empty sound play on the first touch event.
        if (!iosAudioActive) {
            var ibuffer = runtime.audioContext.createBuffer(1, 1, 22050);
            var isource = runtime.audioContext.createBufferSource();
            isource.buffer = ibuffer;
            isource.connect(runtime.audioContext.destination);
            isource.noteOn(0);
            iosAudioActive = true;
        }
    });

    $('#container').bind('touchstart', function(e) {
        runtime.mouseDown = true;
    });

    $('#container').bind('touchend', function(e) {
        runtime.mouseDown = true;
    });

    $('#container').bind('touchmove', function(e) {
        var touch = e.originalEvent.touches[0] || e.originalEvent.changedTouches[0];
        var bb = this.getBoundingClientRect();
        var absX = touch.clientX - bb.left;
        var absY = touch.clientY - bb.top;
        runtime.mousePos = [absX-240, -absY+180];
    });

    // Border touch events - EXPERIMENTAL
    $('#left').bind('touchstart touchmove', function(e) { runtime.keysDown[37] = true; runtime.startKeyHats(37); });
    $('#left').bind('touchend', function(e) { delete runtime.keysDown[37]; });
    $('#up').bind('touchstart touchmove', function(e) { runtime.keysDown[38] = true; runtime.startKeyHats(38); });
    $('#up').bind('touchend', function(e) { delete runtime.keysDown[38]; });
    $('#right').bind('touchstart touchmove', function(e) { runtime.keysDown[39] = true; runtime.startKeyHats(39); });
    $('#right').bind('touchend', function(e) { delete runtime.keysDown[39]; });
    $('#down').bind('touchstart touchmove', function(e) { runtime.keysDown[40] = true; runtime.startKeyHats(40); });
    $('#down').bind('touchend', function(e) { delete runtime.keysDown[40]; });

    // Load the interpreter and primitives
    global.interp = new Interpreter();
    interp.initPrims();

    // Load the requested project and go!
    global.io = new IO();
    io.loadProject(project_id);
};

module.exports = Scratch;

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./IO":1,"./Interpreter":2,"./Runtime":3}],5:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// Sprite.js
// Tim Mickel, July 2011 - March 2012

// The Sprite provides the interface and implementation for Scratch sprite-control

'use strict';

var Color = _dereq_('./util/Color'),
    Rectangle = _dereq_('./util/Rectangle');

var Sprite = function(data) {
    if (!this.data) {
        this.data = data;
    }

    // Public variables used for Scratch-accessible data.
    this.visible = typeof(this.data.visible) == "undefined" ? true : data.visible;

    this.scratchX = data.scratchX || 0;
    this.scratchY = data.scratchY || 0;

    this.scale = data.scale || 1.0;

    this.direction = data.direction || 90;
    this.rotation = (data.direction - 90) || 0;
    this.rotationStyle = data.rotationStyle || 'normal';
    this.isFlipped = data.direction < 0 && data.rotationStyle == 'leftRight';
    this.costumes = data.costumes || [];
    this.currentCostumeIndex = data.currentCostumeIndex || 0;
    this.previousCostumeIndex = -1;

    this.objName = data.objName || '';

    this.variables = {};
    if (data.variables) {
        for (var i = 0; i < data.variables.length; i++) {
            this.variables[data.variables[i]['name']] = data.variables[i]['value'];
        }
    }
    this.lists = {};
    if (data.lists) {
        for (var i = 0; i < data.lists.length; i++) {
            this.lists[data.lists[i]['listName']] = data.lists[i];
        }
    }

    // Used for the pen
    this.penIsDown = false;
    this.penWidth = 1;
    this.penHue = 120; // blue
    this.penShade = 50; // full brightness and saturation
    this.penColorCache = 0x0000FF;

    // Used for layering
    if (!this.z) this.z = io.getCount();

    // HTML element for the talk bubbles
    this.talkBubble = null;
    this.talkBubbleBox = null;
    this.talkBubbleStyler = null;
    this.talkBubbleOn = false;

    // HTML element for the ask bubbles
    this.askInput = null;
    this.askInputField = null;
    this.askInputButton = null;
    this.askInputOn = false;

    // Internal variables used for rendering meshes.
    this.textures = [];
    this.materials = [];
    this.geometries = [];
    this.mesh = null;

    // Sound buffers and data
    this.sounds = {};
    if (data.sounds) {
        for (var i = 0; i < data.sounds.length; i++) {
            this.sounds[data.sounds[i]['soundName']] = data.sounds[i];
        }
    }
    this.soundsLoaded = 0;
    this.instrument = 1;

    // Image effects
    this.filters = {
        color: 0,
        fisheye: 0,
        whirl: 0,
        pixelate: 0,
        mosaic: 0,
        brightness: 0,
        ghost: 0
    };

    // Incremented when images are loaded by the browser.
    this.costumesLoaded = 0;

    // Stacks to be pushed to the interpreter and run
    this.stacks = [];
};

// Attaches a Sprite (<img>) to a Scratch scene
Sprite.prototype.attach = function(scene) {
    // Create textures and materials for each of the costumes.
    for (var c in this.costumes) {
        this.textures[c] = document.createElement('img');
        $(this.textures[c])
        .load([this, c], function(evo) {
            var sprite = evo.handleObj.data[0];
            var c = evo.handleObj.data[1];

            sprite.costumesLoaded += 1;
            sprite.updateCostume();

            $(sprite.textures[c]).css('display', sprite.currentCostumeIndex == c ? 'inline' : 'none');
            $(sprite.textures[c]).css('position', 'absolute').css('left', '0px').css('top', '0px');
            $(sprite.textures[c]).bind('dragstart', function(evt) { evt.preventDefault(); })
                .bind('selectstart', function(evt) { evt.preventDefault(); })
                .bind('touchend', function(evt) { sprite.onClick(evt); $(this).addClass('touched'); })
                .click(function(evt) {
                    if (!$(this).hasClass('touched')) {
                        sprite.onClick(evt);
                    } else {
                        $(this).removeClass('touched');
                    }
                });
            scene.append($(sprite.textures[c]));
        })
        .attr({
            'crossOrigin': 'annonymous',
            'src': io.asset_base + this.costumes[c].baseLayerMD5 + io.asset_suffix
        });
    }

    this.mesh = this.textures[this.currentCostumeIndex];
    this.updateLayer();
    this.updateVisible();
    this.updateTransform();

    if (! this.isStage) {
        this.talkBubble = $('<div class="bubble-container"></div>');
        this.talkBubble.css('display', 'none');
        this.talkBubbleBox = $('<div class="bubble"></div>');
        this.talkBubbleStyler = $('<div class="bubble-say"></div>');
        this.talkBubble.append(this.talkBubbleBox);
        this.talkBubble.append(this.talkBubbleStyler);
    }

    this.askInput = $('<div class="ask-container"></div>');
    this.askInput.css('display', 'none');
    this.askInputField = $('<div class="ask-field"></div>');
    this.askInputTextField = $('<input type="text" class="ask-text-field"></input>');
    this.askInputField.append(this.askInputTextField);
    this.askInputButton = $('<div class="ask-button"></div>');
    this.bindDoAskButton();
    this.askInput.append(this.askInputField);
    this.askInput.append(this.askInputButton);

    runtime.scene.append(this.talkBubble);
    runtime.scene.append(this.askInput);
};

// Load sounds from the server and buffer them
Sprite.prototype.loadSounds = function() {
    var self = this;
    $.each(this.sounds, function(index, sound) {
        io.soundRequest(sound, self);
    });
};

// True when all the costumes have been loaded
Sprite.prototype.isLoaded = function() {
    return this.costumesLoaded == this.costumes.length && this.soundsLoaded == Object.keys(this.sounds).length;
};

// Step methods
Sprite.prototype.showCostume = function(costume) {
    if (costume < 0) {
        costume += this.costumes.length;
    }
    if (!this.textures[costume]) {
        this.currentCostumeIndex = 0;
    }
    else {
        this.currentCostumeIndex = costume;
    }
    this.updateCostume();
};

Sprite.prototype.indexOfCostumeNamed = function(name) {
    for (var i in this.costumes) {
        var c = this.costumes[i];
        if (c['costumeName'] == name) {
            return i;
        }
    }
    return null;
};

Sprite.prototype.showCostumeNamed = function(name) {
    var index = this.indexOfCostumeNamed(name);
    if (!index) return;
    this.showCostume(index);
};

Sprite.prototype.updateCostume = function() {
    if (!this.textures[this.currentCostumeIndex]) {
        this.currentCostumeIndex = 0;
    }
    $(this.mesh).css('display', 'none');
    this.mesh = this.textures[this.currentCostumeIndex];
    this.updateVisible();
    this.updateTransform();
};

Sprite.prototype.onClick = function(evt) {
    // TODO - needs work!!

    // We don't need boxOffset anymore.
    var mouseX = runtime.mousePos[0] + 240;
    var mouseY = 180 - runtime.mousePos[1];

    if (this.mesh.src.indexOf('.svg') == -1) {
        // HACK - if the image SRC doesn't indicate it's an SVG,
        // then we'll try to detect if the point we clicked is transparent
        // by rendering the sprite on a canvas.  With an SVG,
        // we are forced not to do this for now by Chrome/Webkit SOP:
        // http://code.google.com/p/chromium/issues/detail?id=68568
        var canv = document.createElement('canvas');
        canv.width = 480;
        canv.height = 360;
        var ctx = canv.getContext('2d');
        var drawWidth = this.textures[this.currentCostumeIndex].width;
        var drawHeight = this.textures[this.currentCostumeIndex].height;
        var scale = this.scale / (this.costumes[this.currentCostumeIndex].bitmapResolution || 1);
        var rotationCenterX = this.costumes[this.currentCostumeIndex].rotationCenterX;
        var rotationCenterY = this.costumes[this.currentCostumeIndex].rotationCenterY;
        ctx.translate(240 + this.scratchX, 180 - this.scratchY);
        ctx.rotate(this.rotation * Math.PI / 180.0);
        ctx.scale(scale, scale);
        ctx.translate(-rotationCenterX, -rotationCenterY);
        ctx.drawImage(this.mesh, 0, 0);
        document.body.appendChild(canv);

        var idata = ctx.getImageData(mouseX, mouseY, 1, 1).data;
        var alpha = idata[3];
    } else {
        var alpha = 1;
    }

    if (alpha > 0) {
        // Start clicked hats if the pixel is non-transparent
        runtime.startClickedHats(this);
    } else {
        // Otherwise, move back a layer and trigger the click event
        $(this.mesh).hide();
        var bb = $('#container')[0].getBoundingClientRect();
        var underElement = document.elementFromPoint(bb.left + mouseX, bb.top + mouseY);
        $(underElement).click();
        $(this.mesh).show();
    }
};

Sprite.prototype.setVisible = function(v) {
    this.visible = v;
    this.updateVisible();
};

Sprite.prototype.updateLayer = function() {
    $(this.mesh).css('z-index', this.z);
    if (this.talkBubble) this.talkBubble.css('z-index', this.z);
    if (this.askInput) this.askInput.css('z-index', this.z);
};

Sprite.prototype.updateVisible = function() {
    $(this.mesh).css('display', this.visible ? 'inline' : 'none');
    if (this.talkBubbleOn) this.talkBubble.css('display', this.visible ? 'inline-block' : 'none');
    if (this.askInputOn) this.askInput.css('display', this.visible ? 'inline-block' : 'none');
};

Sprite.prototype.updateTransform = function() {
    var texture = this.textures[this.currentCostumeIndex];
    var resolution = this.costumes[this.currentCostumeIndex].bitmapResolution || 1;

    var drawWidth = texture.width * this.scale / resolution;
    var drawHeight = texture.height * this.scale / resolution;

    var rotationCenterX = this.costumes[this.currentCostumeIndex].rotationCenterX;
    var rotationCenterY = this.costumes[this.currentCostumeIndex].rotationCenterY;

    var drawX = this.scratchX + (480 / 2) - rotationCenterX;
    var drawY = -this.scratchY + (360 / 2) - rotationCenterY;

    var scaleXprepend = '';
    if (this.isFlipped) {
        scaleXprepend = '-'; // For a leftRight flip, we add a minus
        // sign to the X scale.
    }

    $(this.mesh).css(
        'transform',
        'translatex(' + drawX + 'px) ' +
        'translatey(' + drawY + 'px) ' +
        'rotate(' + this.rotation + 'deg) ' +
        'scaleX(' + scaleXprepend + (this.scale / resolution) + ') scaleY(' +  (this.scale / resolution) + ')'
    );
    $(this.mesh).css(
        '-moz-transform',
        'translatex(' + drawX + 'px) ' +
        'translatey(' + drawY + 'px) ' +
        'rotate(' + this.rotation + 'deg) ' +
        'scaleX(' + scaleXprepend + this.scale + ') scaleY(' +  this.scale / resolution + ')'
    );
    $(this.mesh).css(
        '-webkit-transform',
        'translatex(' + drawX + 'px) ' +
        'translatey(' + drawY + 'px) ' +
        'rotate(' + this.rotation + 'deg) ' +
        'scaleX(' + scaleXprepend + (this.scale / resolution) + ') scaleY(' +  (this.scale / resolution) + ')'
    );

    $(this.mesh).css('-webkit-transform-origin', rotationCenterX + 'px ' + rotationCenterY + 'px');
    $(this.mesh).css('-moz-transform-origin', rotationCenterX + 'px ' + rotationCenterY + 'px');
    $(this.mesh).css('-ms-transform-origin', rotationCenterX + 'px ' + rotationCenterY + 'px');
    $(this.mesh).css('-o-transform-origin', rotationCenterX + 'px ' + rotationCenterY + 'px');
    $(this.mesh).css('transform-origin', rotationCenterX + 'px ' + rotationCenterY + 'px');

    // Don't forget to update the talk bubble.
    if (this.talkBubble) {
        var xy = this.getTalkBubbleXY();
        this.talkBubble.css('left', xy[0] + 'px');
        this.talkBubble.css('top', xy[1] + 'px');
    }

    this.updateLayer();
};

Sprite.prototype.updateFilters = function() {
    $(this.mesh).css('opacity', 1 - this.filters.ghost / 100);
    $(this.mesh).css(
        '-webkit-filter',
        'hue-rotate(' + (this.filters.color * 1.8) + 'deg) ' +
        'brightness(' + (this.filters.brightness < 0 ? this.filters.brightness / 100 + 1 : Math.min(2.5, this.filters.brightness * .015 + 1)) + ')'
    );
};

Sprite.prototype.getTalkBubbleXY = function() {
    var texture = this.textures[this.currentCostumeIndex];
    var drawWidth = texture.width * this.scale;
    var drawHeight = texture.height * this.scale;
    var rotationCenterX = this.costumes[this.currentCostumeIndex].rotationCenterX;
    var rotationCenterY = this.costumes[this.currentCostumeIndex].rotationCenterY;
    var drawX = this.scratchX + (480 / 2) - rotationCenterX;
    var drawY = -this.scratchY + (360 / 2) - rotationCenterY;
    return [drawX + drawWidth, drawY - drawHeight / 2];
};

Sprite.prototype.showBubble = function(text, type) {
    var xy = this.getTalkBubbleXY();

    this.talkBubbleOn = true;
    this.talkBubble.css('z-index', this.z);
    this.talkBubble.css('left', xy[0] + 'px');
    this.talkBubble.css('top', xy[1] + 'px');

    this.talkBubbleBox.removeClass('say-think-border');
    this.talkBubbleBox.removeClass('ask-border');

    this.talkBubbleStyler.removeClass('bubble-say');
    this.talkBubbleStyler.removeClass('bubble-think');
    this.talkBubbleStyler.removeClass('bubble-ask');
    if (type == 'say') {
        this.talkBubbleBox.addClass('say-think-border');
        this.talkBubbleStyler.addClass('bubble-say');
    } else if (type == 'think') {
        this.talkBubbleBox.addClass('say-think-border');
        this.talkBubbleStyler.addClass('bubble-think');
    } else if (type == 'doAsk') {
        this.talkBubbleBox.addClass('ask-border');
        this.talkBubbleStyler.addClass('bubble-ask');
    }

    if (this.visible) {
        this.talkBubble.css('display', 'inline-block');
    }
    this.talkBubbleBox.html(text);
};

Sprite.prototype.hideBubble = function() {
    this.talkBubbleOn = false;
    this.talkBubble.css('display', 'none');
};

Sprite.prototype.showAsk = function() {
    this.askInputOn = true;
    this.askInput.css('z-index', this.z);
    this.askInput.css('left', '15px');
    this.askInput.css('right', '15px');
    this.askInput.css('bottom', '7px');
    this.askInput.css('height', '25px');

    if (this.visible) {
        this.askInput.css('display', 'inline-block');
        this.askInputTextField.focus();
    }
};

Sprite.prototype.hideAsk = function() {
    this.askInputOn = false;
    this.askInputTextField.val('');
    this.askInput.css('display', 'none');
};

Sprite.prototype.bindDoAskButton = function() {
    var self = this;
    this.askInputButton.on("keypress click", function(e) {
        var eType = e.type;
        if (eType === 'click' || (eType === 'keypress' && e.which === 13)) {
            var stage = interp.targetStage();
            stage.askAnswer = $(self.askInputTextField).val();
            self.hideBubble();
            self.hideAsk();
            interp.activeThread.paused = false;
        }
    });
};

Sprite.prototype.setXY = function(x, y) {
    this.scratchX = x;
    this.scratchY = y;
    this.updateTransform();
};

Sprite.prototype.setDirection = function(d) {
    var rotation;
    d = d % 360
    if (d < 0) d += 360;
    this.direction = d > 180 ? d - 360 : d;
    if (this.rotationStyle == 'normal') {
        rotation = (this.direction - 90) % 360;
    } else if (this.rotationStyle == 'leftRight') {
        if (((this.direction - 90) % 360) >= 0) {
            this.isFlipped = false;
        } else {
            this.isFlipped = true;
        }
        rotation = 0;
    } else {
        rotation = 0;
    }
    this.rotation = rotation;
    this.updateTransform();
};

Sprite.prototype.setRotationStyle = function(r) {
    this.rotationStyle = r;
};

Sprite.prototype.getSize = function() {
    return this.scale * 100;
};

Sprite.prototype.setSize = function(percent) {
    var newScale = percent / 100.0;
    newScale = Math.max(0.05, Math.min(newScale, 100));
    this.scale = newScale;
    this.updateTransform();
};

// Move functions
Sprite.prototype.keepOnStage = function() {
    var x = this.scratchX + 240;
    var y = 180 - this.scratchY;
    var myBox = this.getRect();
    var inset = -Math.min(18, Math.min(myBox.width, myBox.height) / 2);
    var edgeBox = new Rectangle(inset, inset, 480 - (2 * inset), 360 - (2 * inset));
    if (myBox.intersects(edgeBox)) return; // sprite is sufficiently on stage
    if (myBox.right < edgeBox.left) x += edgeBox.left - myBox.right;
    if (myBox.left > edgeBox.right) x -= myBox.left - edgeBox.right;
    if (myBox.bottom < edgeBox.top) y += edgeBox.top - myBox.bottom;
    if (myBox.top > edgeBox.bottom) y -= myBox.top - edgeBox.bottom;
    this.scratchX = x - 240;
    this.scratchY = 180 - y;
};

Sprite.prototype.getRect = function() {
    var cImg = this.textures[this.currentCostumeIndex];
    var x = this.scratchX + 240 - (cImg.width/2.0);
    var y = 180 - this.scratchY - (cImg.height/2.0);
    var myBox = new Rectangle(x, y, cImg.width, cImg.height);
    return myBox;
};

// Pen functions
Sprite.prototype.setPenColor = function(c) {
    var hsv = Color.rgb2hsv(c);
    this.penHue = (200 * hsv[0]) / 360 ;
    this.penShade = 50 * hsv[2];  // not quite right; doesn't account for saturation
    this.penColorCache = c;
};

Sprite.prototype.setPenHue = function(n) {
    this.penHue = n % 200;
    if (this.penHue < 0) this.penHue += 200;
    this.updateCachedPenColor();
};

Sprite.prototype.setPenShade = function(n) {
    this.penShade = n % 200;
    if (this.penShade < 0) this.penShade += 200;
    this.updateCachedPenColor();
};

Sprite.prototype.updateCachedPenColor = function() {
    var c = Color.fromHSV((this.penHue * 180.0) / 100.0, 1, 1);
    var shade = this.penShade > 100 ? 200 - this.penShade : this.penShade; // range 0..100
    if (shade < 50) {
        this.penColorCache = Color.mixRGB(0, c, (10 + shade) / 60.0);
    } else {
        this.penColorCache = Color.mixRGB(c, 0xFFFFFF, (shade - 50) / 60);
    }
};

Sprite.prototype.stamp = function(canvas, opacity) {
    var drawWidth = this.textures[this.currentCostumeIndex].width * this.scale;
    var drawHeight = this.textures[this.currentCostumeIndex].height * this.scale;
    var drawX = this.scratchX + (480 / 2);
    var drawY = -this.scratchY + (360 / 2);
    canvas.globalAlpha = opacity / 100.0;
    canvas.save();
    canvas.translate(drawX, drawY);
    canvas.rotate(this.rotation * Math.PI / 180.0);
    canvas.drawImage(this.mesh, -drawWidth/2, -drawHeight/2, drawWidth, drawHeight);
    canvas.restore();
    canvas.globalAlpha = 1;
};

Sprite.prototype.soundNamed = function(name) {
    if (name in this.sounds && this.sounds[name].buffer) {
        return this.sounds[name];
    } else if (name in runtime.stage.sounds && runtime.stage.sounds[name].buffer) {
        return runtime.stage.sounds[name];
    }
    return null;
};

Sprite.prototype.resetFilters = function() {
    this.filters = {
        color: 0,
        fisheye: 0,
        whirl: 0,
        pixelate: 0,
        mosaic: 0,
        brightness: 0,
        ghost: 0
    };
    this.updateFilters();
};

module.exports = Sprite;

},{"./util/Color":15,"./util/Rectangle":17}],6:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// Stage.js
// Tim Mickel, July 2011 - March 2012

// Provides the basic logic for the Stage, a special kind of Sprite.

'use strict';

var Sprite = _dereq_('./Sprite');

var Stage = function(data) {
    // Place the background layer in the very back.
    // The pen layer is right above the stage background,
    // and all sprites are above that.
    this.z = -2;

    // Pen layer and canvas cache.
    this.penLayerLoaded = false;
    this.lineCanvas = document.createElement('canvas');
    this.lineCanvas.width = 480;
    this.lineCanvas.height = 360;
    this.lineCache = this.lineCanvas.getContext('2d');
    this.isStage = true;
    this.askAnswer = ""; //this is a private variable and should be blank

    Sprite.call(this, data);
};

Stage.prototype = Object.create(Sprite.prototype);
Stage.prototype.constructor = Stage;

Stage.prototype.attachPenLayer = function(scene) {
    if (this.penLayerLoaded) return;
    this.penLayerLoaded = true;
    $(this.lineCanvas).css('position', 'absolute');
    $(this.lineCanvas).css('z-index', '-1');
    scene.append(this.lineCanvas);
};

Stage.prototype.isLoaded = function() {
    return this.penLayerLoaded && this.costumesLoaded == this.costumes.length && this.soundsLoaded == Object.keys(this.sounds).length;
};

// Pen functions
Stage.prototype.clearPenStrokes = function() {
    this.lineCache.clearRect(0, 0, 480, 360);
};

Stage.prototype.stroke = function(from, to, width, color) {
    this.lineCache.lineWidth = width;
    this.lineCache.lineCap = 'round';
    this.lineCache.beginPath();
    // Use .5 offsets for canvas rigid pixel drawing
    this.lineCache.moveTo(from[0] + 240.5, 180.5 - from[1]);
    this.lineCache.lineTo(to[0] + 240.5, 180.5 - to[1]);
    this.lineCache.strokeStyle = 'rgb(' + (color >> 16) + ',' + (color >> 8 & 255) + ',' + (color & 255) + ')';
    this.lineCache.stroke();
};

module.exports = Stage;

},{"./Sprite":5}],7:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

'use strict';

var LooksPrims = function() {};

LooksPrims.prototype.addPrimsTo = function(primTable) {
    primTable['show']               = this.primShow;
    primTable['hide']               = this.primHide;

    primTable['nextCostume']        = this.primNextCostume;
    primTable['lookLike:']          = this.primShowCostume;
    primTable['costumeIndex']       = this.primCostumeNum;

    primTable['nextScene']     = this.primNextCostume;
    primTable['showBackground:']    = this.primShowCostume;
    primTable['backgroundIndex']    = this.primCostumeNum;

    primTable['startScene']         = this.primStartScene;
    primTable['backgroundIndex']    = this.primCostumeNum;

    primTable['changeSizeBy:']      = this.primChangeSize;
    primTable['setSizeTo:']         = this.primSetSize;
    primTable['scale']              = this.primSize;

    primTable['comeToFront']        = this.primGoFront;
    primTable['goBackByLayers:']    = this.primGoBack;

    primTable['changeGraphicEffect:by:'] = this.primChangeEffect;
    primTable['setGraphicEffect:to:']    = this.primSetEffect;
    primTable['filterReset']             = this.primClearEffects;

    primTable['say:'] = function(b) { showBubble(b, 'say'); };
    primTable['say:duration:elapsed:from:'] = function(b) { showBubbleAndWait(b, 'say'); };
    primTable['think:'] = function(b) { showBubble(b, 'think'); };
    primTable['think:duration:elapsed:from:'] = function(b) { showBubbleAndWait(b, 'think'); };
};

LooksPrims.prototype.primShow = function(b) {
    interp.targetSprite().setVisible(true);
    interp.redraw();
};

LooksPrims.prototype.primHide = function(b) {
    interp.targetSprite().setVisible(false);
    interp.redraw();
};

LooksPrims.prototype.primNextCostume = function(b) {
    interp.targetSprite().showCostume(interp.targetSprite().currentCostumeIndex + 1);
    interp.redraw();
};

LooksPrims.prototype.primShowCostume = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    var arg = interp.arg(b, 0);
    if (typeof(arg) == 'number') {
        s.showCostume(arg - 1);
    } else {
        if ((arg == 'CAMERA') || (arg == 'CAMERA - MIRROR')) {
            s.showCostumeNamed(arg);
            return;
        }
        var i = s.indexOfCostumeNamed(arg);
        if (i >= 0) {
            s.showCostume(i);
        } else {
            var n = parseInt(arg, 10);
            if (n === n) { // if n is not NaN
                s.showCostume(n - 1);
            } else {
                return;  // arg did not match a costume name nor is a valid number
            }
        }
    }
    if (s.visible) interp.redraw();
};

LooksPrims.prototype.primStartScene = function(b) {
    var s = runtime.stage;
    var arg = interp.arg(b, 0);
    if (typeof(arg) == 'number') {
        s.showCostume(arg - 1);
    } else {
        if ((arg == 'CAMERA') || (arg == 'CAMERA - MIRROR')) {
            s.showCostumeNamed(arg);
            return;
        }
        var i = s.indexOfCostumeNamed(arg);
        if (i >= 0) {
            s.showCostume(i);
        } else {
            var n = parseInt(arg, 10);
            if (n === n) { // fast !isNaN check
                s.showCostume(n - 1);
            } else {
                return;  // arg did not match a costume name nor is a valid number
            }
        }
    }
    if (s.visible) interp.redraw();
};

LooksPrims.prototype.primCostumeNum = function(b) {
    var s = interp.targetSprite();
    return s == null ? 1 : s.currentCostumeIndex + 1;
};

LooksPrims.prototype.primChangeSize = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    s.setSize(s.getSize() + interp.numarg(b, 0));
    if (s.visible) interp.redraw();
};

LooksPrims.prototype.primSetSize = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    s.setSize(interp.numarg(b, 0));
    if (s.visible) interp.redraw();
};

LooksPrims.prototype.primSize = function(b) {
    var s = interp.targetSprite();
    if (s == null) return 100;
    return s.getSize();
};

LooksPrims.prototype.primGoFront = function(b) {
    var s = interp.targetSprite();
    runtime.reassignZ(s, null);
    if (s.visible) interp.redraw();
};

LooksPrims.prototype.primGoBack = function(b) {
    var s = interp.targetSprite();
    runtime.reassignZ(s, interp.numarg(b, 0));
    if(s.visible) interp.redraw();
};

LooksPrims.prototype.primChangeEffect = function(b) {
    var s = interp.targetSprite();
    s.filters[interp.arg(b, 0)] += interp.numarg(b, 1);
    s.updateFilters();
};

LooksPrims.prototype.primSetEffect = function(b) {
    var s = interp.targetSprite();
    s.filters[interp.arg(b, 0)] = interp.numarg(b, 1);
    s.updateFilters();
};

LooksPrims.prototype.primClearEffects = function(b) {
    var s = interp.targetSprite();
    s.resetFilters();
    s.updateFilters();
};

var showBubble = function(b, type) {
    var s = interp.targetSprite();
    if (s !== null) s.showBubble(interp.arg(b, 0), type);
};

var showBubbleAndWait = function(b, type) {
    var s = interp.targetSprite();
    if (s === null) return;
    if (interp.activeThread.firstTime) {
        var text = interp.arg(b, 0);
        var secs = interp.numarg(b, 1);
        s.showBubble(text, type);
        if (s.visible) interp.redraw();
        interp.startTimer(secs);
    } else {
        if (interp.checkTimer()) s.hideBubble();
    }
};

module.exports = LooksPrims;

},{}],8:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

'use strict';

var MotionAndPenPrims = function() {};

MotionAndPenPrims.prototype.addPrimsTo = function(primTable) {
    primTable['forward:']           = this.primMove;
    primTable['turnLeft:']          = this.primTurnLeft;
    primTable['turnRight:']         = this.primTurnRight;
    primTable['heading:']           = this.primSetDirection;
    primTable['pointTowards:']      = this.primPointTowards;
    primTable['gotoX:y:']           = this.primGoTo;
    primTable['gotoSpriteOrMouse:']  = this.primGoToSpriteOrMouse;
    primTable['glideSecs:toX:y:elapsed:from:'] = this.primGlide;

    primTable['changeXposBy:']      = this.primChangeX;
    primTable['xpos:']              = this.primSetX;
    primTable['changeYposBy:']      = this.primChangeY;
    primTable['ypos:']              = this.primSetY;

    primTable['bounceOffEdge']      = this.primBounceOffEdge;
    primTable['setRotationStyle']   = this.primSetRotationStyle;

    primTable['xpos']               = this.primXPosition;
    primTable['ypos']               = this.primYPosition;
    primTable['heading']            = this.primDirection;

    primTable['clearPenTrails']     = this.primClear;
    primTable['putPenDown']         = this.primPenDown;
    primTable['putPenUp']           = this.primPenUp;
    primTable['penColor:']          = this.primSetPenColor;
    primTable['setPenHueTo:']       = this.primSetPenHue;
    primTable['changePenHueBy:']    = this.primChangePenHue;
    primTable['setPenShadeTo:']     = this.primSetPenShade;
    primTable['changePenShadeBy:']  = this.primChangePenShade;
    primTable['penSize:']           = this.primSetPenSize;
    primTable['changePenSizeBy:']   = this.primChangePenSize;

    primTable['stampCostume']       = this.primStamp;
    primTable['stampTransparent']   = this.primStampTransparent;
};

MotionAndPenPrims.prototype.primMove = function(b) {
    var s = interp.targetSprite();
    var radians = (90 - s.direction) * Math.PI / 180;
    var d = interp.numarg(b, 0);

    moveSpriteTo(s, s.scratchX + d * Math.cos(radians), s.scratchY + d * Math.sin(radians));
    if (s.visible) interp.redraw();
};

MotionAndPenPrims.prototype.primTurnLeft = function(b) {
    var s = interp.targetSprite();
    var d = s.direction - interp.numarg(b, 0);
    s.setDirection(d);
    if (s.visible) interp.redraw();
};

MotionAndPenPrims.prototype.primTurnRight = function(b) {
    var s = interp.targetSprite();
    var d = s.direction + interp.numarg(b, 0);
    s.setDirection(d);
    if (s.visible) interp.redraw();
};

MotionAndPenPrims.prototype.primSetDirection = function(b) {
    var s = interp.targetSprite();
    s.setDirection(interp.numarg(b, 0));
    if (s.visible) interp.redraw();
};

MotionAndPenPrims.prototype.primPointTowards = function(b) {
    var s = interp.targetSprite();
    var p = mouseOrSpritePosition(interp.arg(b, 0));
    if (s == null || p == null) return;
    var dx = p.x - s.scratchX;
    var dy = p.y - s.scratchY;
    var angle = 90 - Math.atan2(dy, dx) * 180 / Math.PI;
    s.setDirection(angle);
    if (s.visible) interp.redraw();
};

MotionAndPenPrims.prototype.primGoTo = function(b) {
    var s = interp.targetSprite();
    if (s != null) moveSpriteTo(s, interp.numarg(b, 0), interp.numarg(b, 1));
};

MotionAndPenPrims.prototype.primGoToSpriteOrMouse = function(b) {
    var s = interp.targetSprite();
    var p = mouseOrSpritePosition(interp.arg(b, 0));
    if (s == null || p == null) return;
    moveSpriteTo(s, p.x, p.y);
};

MotionAndPenPrims.prototype.primGlide = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    if (interp.activeThread.firstTime) {
        var secs = interp.numarg(b, 0);
        var destX = interp.numarg(b, 1);
        var destY = interp.numarg(b, 2);
        if (secs <= 0) {
            moveSpriteTo(s, destX, destY);
            return;
        }
        // record state: [0]start msecs, [1]duration, [2]startX, [3]startY, [4]endX, [5]endY
        interp.activeThread.tmpObj = [interp.currentMSecs, 1000 * secs, s.scratchX, s.scratchY, destX, destY];
        interp.startTimer(secs);
    } else {
        var state = interp.activeThread.tmpObj;
        if (!interp.checkTimer()) {
            // in progress: move to intermediate position along path
            var frac = (interp.currentMSecs - state[0]) / state[1];
            var newX = state[2] + frac * (state[4] - state[2]);
            var newY = state[3] + frac * (state[5] - state[3]);
            moveSpriteTo(s, newX, newY);
        } else {
            // finished: move to final position and clear state
            moveSpriteTo(s, state[4], state[5]);
            interp.activeThread.tmpObj = null;
        }
    }
};

MotionAndPenPrims.prototype.primChangeX = function(b) {
    var s = interp.targetSprite();
    if (s != null) moveSpriteTo(s, s.scratchX + interp.numarg(b, 0), s.scratchY);
};

MotionAndPenPrims.prototype.primSetX = function(b) {
    var s = interp.targetSprite();
    if (s != null) moveSpriteTo(s, interp.numarg(b, 0), s.scratchY);
};

MotionAndPenPrims.prototype.primChangeY = function(b) {
    var s = interp.targetSprite();
    if (s != null) moveSpriteTo(s, s.scratchX, s.scratchY + interp.numarg(b, 0));
};

MotionAndPenPrims.prototype.primSetY = function(b) {
    var s = interp.targetSprite();
    if (s != null) moveSpriteTo(s, s.scratchX, interp.numarg(b, 0));
};

MotionAndPenPrims.prototype.primBounceOffEdge = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    if (!turnAwayFromEdge(s)) return;
    ensureOnStageOnBounce(s);
    if (s.visible) interp.redraw();
};

MotionAndPenPrims.prototype.primSetRotationStyle = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    var request = interp.arg(b, 0);
    var rotationStyle = 'normal';
    if (request == 'all around') rotationStyle = 'normal';
    else if (request == 'left-right') rotationStyle = 'leftRight';
    else if (request == 'none') rotationStyle = 'none';
    s.setRotationStyle(rotationStyle);
};

MotionAndPenPrims.prototype.primXPosition = function(b) {
    var s = interp.targetSprite();
    return s != null ? s.scratchX : 0;
};

MotionAndPenPrims.prototype.primYPosition = function(b) {
    var s = interp.targetSprite();
    return s != null ? s.scratchY : 0;
};

MotionAndPenPrims.prototype.primDirection = function(b) {
    var s = interp.targetSprite();
    return s != null ? s.direction : 0;
};

MotionAndPenPrims.prototype.primClear = function(b) {
    runtime.stage.clearPenStrokes();
    interp.redraw();
};

MotionAndPenPrims.prototype.primPenDown = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.penIsDown = true;
    stroke(s, s.scratchX, s.scratchY, s.scratchX + 0.2, s.scratchY + 0.2);
    interp.redraw();
};

MotionAndPenPrims.prototype.primPenUp = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.penIsDown = false;
};

MotionAndPenPrims.prototype.primSetPenColor = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.setPenColor(interp.numarg(b, 0));
};

MotionAndPenPrims.prototype.primSetPenHue = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.setPenHue(interp.numarg(b, 0));
};

MotionAndPenPrims.prototype.primChangePenHue = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.setPenHue(s.penHue + interp.numarg(b, 0));
};

MotionAndPenPrims.prototype.primSetPenShade = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.setPenShade(interp.numarg(b, 0));
};

MotionAndPenPrims.prototype.primChangePenShade = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.setPenShade(s.penShade + interp.numarg(b, 0));
};

MotionAndPenPrims.prototype.primSetPenSize = function(b) {
    var s = interp.targetSprite();
    var w = Math.max(0, Math.min(interp.numarg(b, 0), 100));
    if (s != null) s.penWidth = w;
};

MotionAndPenPrims.prototype.primChangePenSize = function(b) {
    var s = interp.targetSprite();
    var w = Math.max(0, Math.min(s.penWidth + interp.numarg(b, 0), 100));
    if (s != null) s.penWidth = w;
};

MotionAndPenPrims.prototype.primStamp = function(b) {
    var s = interp.targetSprite();
    s.stamp(runtime.stage.lineCache, 100);
};

MotionAndPenPrims.prototype.primStampTransparent = function(b) {
    var s = interp.targetSprite();
    var transparency = Math.max(0, Math.min(interp.numarg(b, 0), 100));
    var alpha = 100 - transparency;
    s.stamp(runtime.stage.lineCache, alpha);
};

// Helpers
var stroke = function(s, oldX, oldY, newX, newY) {
    runtime.stage.stroke([oldX, oldY], [newX, newY], s.penWidth, s.penColorCache);
    interp.redraw();
};

var mouseOrSpritePosition = function(arg) {
    if (arg == '_mouse_') {
        var w = runtime.stage;
        return new Point(runtime.mousePos[0], runtime.mousePos[1]);
    } else {
        var s = runtime.spriteNamed(arg);
        if (s == null) return null;
        return new Point(s.scratchX, s.scratchY);
    }
    return null;
};

var moveSpriteTo = function(s, newX, newY) {
    var oldX = s.scratchX;
    var oldY = s.scratchY;
    s.setXY(newX, newY);
    s.keepOnStage();
    if (s.penIsDown) stroke(s, oldX, oldY, s.scratchX, s.scratchY);
    if (s.penIsDown || s.visible) interp.redraw();
};

var turnAwayFromEdge = function(s) {
    // turn away from the nearest edge if it's close enough; otherwise do nothing
    // Note: comparisions are in the stage coordinates, with origin (0, 0)
    // use bounding rect of the sprite to account for costume rotation and scale
    var r = s.getRect();
    // measure distance to edges
    var d1 = Math.max(0, r.left);
    var d2 = Math.max(0, r.top);
    var d3 = Math.max(0, 480 - r.right);
    var d4 = Math.max(0, 360 - r.bottom);
    // find the nearest edge
    var e = 0, minDist = 100000;
    if (d1 < minDist) { minDist = d1; e = 1; }
    if (d2 < minDist) { minDist = d2; e = 2; }
    if (d3 < minDist) { minDist = d3; e = 3; }
    if (d4 < minDist) { minDist = d4; e = 4; }
    if (minDist > 0) return false;  // not touching to any edge
    // point away from nearest edge
    var radians = (90 - s.direction) * Math.PI / 180;
    var dx = Math.cos(radians);
    var dy = -Math.sin(radians);
    if (e == 1) { dx = Math.max(0.2, Math.abs(dx)); }
    if (e == 2) { dy = Math.max(0.2, Math.abs(dy)); }
    if (e == 3) { dx = 0 - Math.max(0.2, Math.abs(dx)); }
    if (e == 4) { dy = 0 - Math.max(0.2, Math.abs(dy)); }
    var newDir = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    s.direction = newDir;
    return true;
};

var ensureOnStageOnBounce = function(s) {
    var r = s.getRect();
    if (r.left < 0) moveSpriteTo(s, s.scratchX - r.left, s.scratchY);
    if (r.top < 0) moveSpriteTo(s, s.scratchX, s.scratchY + r.top);
    if (r.right > 480) {
        moveSpriteTo(s, s.scratchX - (r.right - 480), s.scratchY);
    }
    if (r.bottom > 360) {
        moveSpriteTo(s, s.scratchX, s.scratchY + (r.bottom - 360));
    }
};

module.exports = MotionAndPenPrims;

},{}],9:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// Primitives.js
// Tim Mickel, July 2011

// Provides the basic primitives for the interpreter and loads in the more
// complicated primitives, e.g. MotionAndPenPrims.

'use strict';

var LooksPrims = _dereq_('./LooksPrims'),
    MotionAndPenPrims = _dereq_('./MotionAndPenPrims'),
    SensingPrims = _dereq_('./SensingPrims'),
    SoundPrims = _dereq_('./SoundPrims'),
    VarListPrims = _dereq_('./VarListPrims');


var Primitives = function() {}

Primitives.prototype.addPrimsTo = function(primTable) {
    // Math primitives
    primTable['+']        = function(b) { return interp.numarg(b, 0) + interp.numarg(b, 1); };
    primTable['-']        = function(b) { return interp.numarg(b, 0) - interp.numarg(b, 1); };
    primTable['*']        = function(b) { return interp.numarg(b, 0) * interp.numarg(b, 1); };
    primTable['/']        = function(b) { return interp.numarg(b, 0) / interp.numarg(b, 1); };
    primTable['%']        = this.primModulo;
    primTable['randomFrom:to:'] = this.primRandom;
    primTable['<']        = function(b) { return (interp.numarg(b, 0) < interp.numarg(b, 1)); };
    primTable['=']        = function(b) { return (interp.arg(b, 0) == interp.arg(b, 1)); };
    primTable['>']        = function(b) { return (interp.numarg(b, 0) > interp.numarg(b, 1)); };
    primTable['&']        = function(b) { return interp.boolarg(b, 0) && interp.boolarg(b, 1); };
    primTable['|']        = function(b) { return interp.boolarg(b, 0) || interp.boolarg(b, 1); };
    primTable['not']      = function(b) { return !interp.boolarg(b, 0); };
    primTable['abs']      = function(b) { return Math.abs(interp.numarg(b, 0)); };
    primTable['sqrt']     = function(b) { return Math.sqrt(interp.numarg(b, 0)); };

    primTable['\\\\']               = this.primModulo;
    primTable['rounded']            = function(b) { return Math.round(interp.numarg(b, 0)); };
    primTable['computeFunction:of:'] = this.primMathFunction;

    // String primitives
    primTable['concatenate:with:']  = function(b) { return '' + interp.arg(b, 0) + interp.arg(b, 1); };
    primTable['letter:of:']         = this.primLetterOf;
    primTable['stringLength:']      = function(b) { return interp.arg(b, 0).length; };

    new VarListPrims().addPrimsTo(primTable);
    new MotionAndPenPrims().addPrimsTo(primTable);
    new LooksPrims().addPrimsTo(primTable);
    new SensingPrims().addPrimsTo(primTable);
    new SoundPrims().addPrimsTo(primTable);
}

Primitives.prototype.primRandom = function(b) {
    var n1 = interp.numarg(b, 0);
    var n2 = interp.numarg(b, 1);
    var low = n1 <= n2 ? n1 : n2;
    var hi = n1 <= n2 ? n2 : n1;
    if (low == hi) return low;
    // if both low and hi are ints, truncate the result to an int
    if (Math.floor(low) == low && Math.floor(hi) == hi) {
        return low + Math.floor(Math.random() * (hi + 1 - low));
    }
    return Math.random() * (hi - low) + low;
}

Primitives.prototype.primLetterOf = function(b) {
    var s = interp.arg(b, 1);
    var i = interp.numarg(b, 0) - 1;
    if (i < 0 || i >= s.length) return '';
    return s.charAt(i);
}

Primitives.prototype.primModulo = function(b) {
    var dividend = interp.numarg(b, 1);
    var n = interp.numarg(b, 0) % dividend;
    if (n / dividend < 0) n += dividend;
    return n;
}

Primitives.prototype.primMathFunction = function(b) {
    var op = interp.arg(b, 0);
    var n = interp.numarg(b, 1);
    switch(op) {
        case 'abs': return Math.abs(n);
        case 'sqrt': return Math.sqrt(n);
        case 'sin': return Math.sin(n * Math.PI / 180);
        case 'cos': return Math.cos(n * Math.PI / 180);
        case 'tan': return Math.tan(n * Math.PI / 180);
        case 'asin': return Math.asin(n) * 180 / Math.PI;
        case 'acos': return Math.acos(n) * 180 / Math.PI;
        case 'atan': return Math.atan(n) * 180 / Math.PI;
        case 'ln': return Math.log(n);
        case 'log': return Math.log(n) / Math.LN10;
        case 'e ^': return Math.exp(n);
        case '10 ^': return Math.exp(n * Math.LN10);
    }
    return 0;
}

module.exports = Primitives;

},{"./LooksPrims":7,"./MotionAndPenPrims":8,"./SensingPrims":10,"./SoundPrims":11,"./VarListPrims":12}],10:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

'use strict';

var SensingPrims = function() {};

SensingPrims.prototype.addPrimsTo = function(primTable) {
    primTable['touching:']      = this.primTouching;
    primTable['touchingColor:'] = this.primTouchingColor;
    primTable['color:sees:']    = this.primColorTouchingColor;

    primTable['doAsk']              = this.primDoAsk;
    primTable['answer']             = this.primAnswer;

    primTable['keyPressed:']  = this.primKeyPressed;
    primTable['mousePressed'] = function(b) { return runtime.mouseDown; };
    primTable['mouseX']       = function(b) { return runtime.mousePos[0]; };
    primTable['mouseY']       = function(b) { return runtime.mousePos[1]; };
    primTable['distanceTo:']  = this.primDistanceTo;

    primTable['getAttribute:of:'] = this.primGetAttribute;

    primTable['timeAndDate']  = function(b) { return runtime.getTimeString(interp.arg(b, 0)); };
    primTable['timestamp'] = this.primTimestamp;
};

SensingPrims.prototype.primTouching = function(b) {
    var s = interp.targetSprite();
    if (s == null || !s.visible) return false;

    var arg = interp.arg(b, 0);
    if (arg == '_edge_') {
        return false; // TODO
    }

    if (arg == '_mouse_') {
        return false; // TODO
    }

    var s2 = runtime.spriteNamed(arg);
    if (s2 == null || !s2.visible) return false;

    return spriteHitTest(s, s2);
};

SensingPrims.prototype.primTouchingColor = function(b) {
    var s = interp.targetSprite();
    if (s == null || !s.visible) return false;

    var color = interp.arg(b, 0);

    return stageColorHitTest(s, color);
};

SensingPrims.prototype.primColorTouchingColor = function(b) {
    var s = interp.targetSprite();
    if (s == null || !s.visible) return false;

    var myColor = interp.arg(b, 0);
    var stageColor = interp.arg(b, 1);

    return stageColorByColorHitTest(s, myColor, stageColor);
};

var spriteHitTest = function(a, b) {
    var hitCanvas = document.createElement('canvas');
    hitCanvas.width = 480;
    hitCanvas.height = 360;
    var hitTester = hitCanvas.getContext('2d');
    hitTester.globalCompositeOperation = 'source-over';
    a.stamp(hitTester, 100);
    hitTester.globalCompositeOperation = 'source-in';
    b.stamp(hitTester, 100);

    var aData = hitTester.getImageData(0, 0, 480, 360).data;

    var pxCount = aData.length;
    for (var i = 0; i < pxCount; i += 4) {
        if (aData[i+3] > 0) {
            return true;
        }
    }
    return false;
};

var stageColorHitTest = function(target, color) {
    var r, g, b;
    r = (color >> 16);
    g = (color >> 8 & 255);
    b = (color & 255);

    var targetCanvas = document.createElement('canvas');
    targetCanvas.width = 480;
    targetCanvas.height = 360;
    var targetTester = targetCanvas.getContext('2d');
    target.stamp(targetTester, 100);

    var stageCanvas = document.createElement('canvas');
    stageCanvas.width = 480;
    stageCanvas.height = 360;
    var stageContext = stageCanvas.getContext('2d');

    $.each(runtime.sprites, function(i, sprite) {
        if (sprite != target)
            sprite.stamp(stageContext, 100);
    });

    var hitData = stageContext.getImageData(0, 0, stageCanvas.width, stageCanvas.height).data;
    var meshData = targetTester.getImageData(0, 0, targetCanvas.width, targetCanvas.height).data;
    var pxCount = meshData.length;
    for (var i = 0; i < pxCount; i += 4) {
        if (meshData[i+3] > 0 && hitData[i] == r && hitData[i+1] == g && hitData[i+2] == b)
            return true;
    }
    return false;
};

var stageColorByColorHitTest = function(target, myColor, otherColor) {
    var threshold_acceptable = function(a, b, c, x, y, z) {
        var diff_a = Math.abs(a-x);
        var diff_b = Math.abs(b-y);
        var diff_c = Math.abs(c-z);
        if (diff_a + diff_b + diff_c < 100) {
            return true;
        }
        return false;
    };
    var targetCanvas = document.createElement('canvas');
    targetCanvas.width = 480;
    targetCanvas.height = 360;
    var targetTester = targetCanvas.getContext('2d');
    target.stamp(targetTester, 100);
    var targetData = targetTester.getImageData(0, 0, targetCanvas.width, targetCanvas.height).data;

    // Calculate RGB values of the colors - TODO thresholding
    //myColor = Math.abs(myColor);
    //otherColor = Math.abs(otherColor);
    var mr, mg, mb, or, og, ob;
    mr = (myColor >> 16);
    mg = (myColor >> 8 & 255);
    mb = (myColor & 255);
    or = (otherColor >> 16);
    og = (otherColor >> 8 & 255);
    ob = (otherColor & 255);

    // Create the hit canvas for comparison
    var hitCanvas = document.createElement('canvas');
    hitCanvas.width = 480;
    hitCanvas.height = 360;
    var hitCtx = hitCanvas.getContext('2d');
    $.each(runtime.sprites, function(i, sprite) {
        if (sprite != target) {
            sprite.stamp(hitCtx, 100);
        }
    });

    var hitData = hitCtx.getImageData(0, 0, hitCanvas.width, hitCanvas.height).data;
    var pxCount = targetData.length;
    for (var i = 0; i < pxCount; i += 4) {
        if (threshold_acceptable(targetData[i], targetData[i+1], targetData[i+2], mr, mg, mb) && threshold_acceptable(hitData[i], hitData[i+1], hitData[i+2], or, og, ob)) {
            return true;
        }
    }
    return false;
};

SensingPrims.prototype.primDoAsk= function(b) {
    showBubble(b, "doAsk");
    var s = interp.targetSprite();
    if (s !== null) {
        interp.activeThread.paused = true;
        s.showAsk();
    }
};

SensingPrims.prototype.primAnswer = function(b) {
    var s = interp.targetStage();
    return (s !== null ? s.askAnswer : undefined);
};


SensingPrims.prototype.primKeyPressed = function(b) {
    var key = interp.arg(b, 0);
    var ch = key.charCodeAt(0);
    if (ch > 127) return false;
    if (key == "left arrow") ch = 37;
    if (key == "right arrow") ch = 39;
    if (key == "up arrow") ch = 38;
    if (key == "down arrow") ch = 40;
    if (key == "space") ch = 32;
    return (typeof(runtime.keysDown[ch]) != 'undefined');
};

SensingPrims.prototype.primDistanceTo = function(b) {
    var s = interp.targetSprite();
    var p = mouseOrSpritePosition(interp.arg(b, 0));
    if (s == null || p == null) return 0;
    var dx = p.x - s.scratchX;
    var dy = p.y - s.scratchY;
    return Math.sqrt((dx * dx) + (dy * dy));
};

SensingPrims.prototype.primGetAttribute = function(b) {
    var attr = interp.arg(b, 0);
    var targetSprite = runtime.spriteNamed(interp.arg(b, 1));
    if (targetSprite == null) return 0;
    if (attr == 'x position') return targetSprite.scratchX;
    if (attr == 'y position') return targetSprite.scratchY;
    if (attr == 'direction') return targetSprite.direction;
    if (attr == 'costume #') return targetSprite.currentCostumeIndex + 1;
    if (attr == 'costume name') return targetSprite.costumes[targetSprite.currentCostumeIndex]['costumeName'];
    if (attr == 'size') return targetSprite.getSize();
    if (attr == 'volume') return targetSprite.volume;
    return 0;
};

SensingPrims.prototype.primTimeDate = function(b) {
    var dt = interp.arg(b, 0);
    var now = new Date();
    if (dt == 'year') return now.getFullYear();
    if (dt == 'month') return now.getMonth()+1;
    if (dt == 'date') return now.getDate();
    if (dt == 'day of week') return now.getDay()+1;
    if (dt == 'hour') return now.getHours();
    if (dt == 'minute') return now.getMinutes();
    if (dt == 'second') return now.getSeconds();
    return 0;
};

SensingPrims.prototype.primTimestamp = function(b) {
    var now = new Date();
    var epoch = new Date(2000, 0, 1);
    var dst = now.getTimezoneOffset() - epoch.getTimezoneOffset();
    var msSince = now.getTime() - epoch.getTime();
    msSince -= dst * 60000;
    return msSince / 86400000;
};

// Helpers
SensingPrims.prototype.mouseOrSpritePosition = function(arg) {
    if (arg == "_mouse_") {
        var w = runtime.stage;
        return new Point(runtime.mousePos[0], runtime.mousePos[1]);
    } else {
        var s = runtime.spriteNamed(arg);
        if (s == null) return null;
        return new Point(s.scratchX, s.scratchY);
    }
    return null;
};

module.exports = SensingPrims;

},{}],11:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

'use strict';

var SoundPrims = function() {};

SoundPrims.prototype.addPrimsTo = function(primTable) {
    primTable['playSound:'] = this.primPlaySound;
    primTable['doPlaySoundAndWait'] = this.primPlaySoundUntilDone;
    primTable['stopAllSounds'] = this.primStopAllSounds;

    primTable['playDrum'] = this.primPlayDrum;
    primTable['rest:elapsed:from:'] = this.primPlayRest;
    primTable['noteOn:duration:elapsed:from:'] = this.primPlayNote;
    primTable['instrument:'] = this.primSetInstrument;

    /*primTable['changeVolumeBy:'] = this.primChangeVolume;
    primTable['setVolumeTo:'] = this.primSetVolume;
    primTable['volume'] = this.primVolume;*/

    primTable['changeTempoBy:'] = function(b) { runtime.stage.data.tempoBPM = runtime.stage.data.tempoBPM + interp.arg(b, 0); };
    primTable['setTempoTo:'] = function(b) { runtime.stage.data.tempoBPM = interp.arg(b, 0); };
    primTable['tempo'] = function(b) { return runtime.stage.data.tempoBPM; };
};

var playSound = function(snd) {
    if (snd.source) {
        // If this particular sound is already playing, stop it.
        snd.source.noteOff(0);
        snd.source = null;
    }

    snd.source = runtime.audioContext.createBufferSource();
    snd.source.buffer = snd.buffer;
    snd.source.connect(runtime.audioGain);

    // Track the sound's completion state
    snd.source.done = false;
    snd.source.finished = function() {
        // Remove from the active audio list and disconnect the source from
        // the sound dictionary.
        var i = runtime.audioPlaying.indexOf(snd);
        if (i > -1 && runtime.audioPlaying[i].source != null) {
            runtime.audioPlaying[i].source.done = true;
            runtime.audioPlaying[i].source = null;
            runtime.audioPlaying.splice(i, 1);
        }
    }
    window.setTimeout(snd.source.finished, snd.buffer.duration * 1000);
    // Add the global list of playing sounds and start playing.
    runtime.audioPlaying.push(snd);
    snd.source.noteOn(0);
    return snd.source;
};

var playDrum = function(drum, secs, client) {
    var player = SoundBank.getDrumPlayer(drum, secs);
    player.client = client;
    player.setDuration(secs);
    var source = runtime.audioContext.createScriptProcessor(4096, 1, 1);
    source.onaudioprocess = function(e) { player.writeSampleData(e); };
    source.soundPlayer = player;
    source.connect(runtime.audioGain);
    runtime.notesPlaying.push(source);
    source.finished = function() {
        var i = runtime.notesPlaying.indexOf(source);
        if (i > -1 && runtime.notesPlaying[i] != null) {
            runtime.notesPlaying.splice(i, 1);
        }
    }
    window.setTimeout(source.finished, secs * 1000);
    return player;
};

var playNote = function(instrument, midiKey, secs, client) {
    var player =  SoundBank.getNotePlayer(instrument, midiKey);
    player.client = client;
    player.setNoteAndDuration(midiKey, secs);
    var source = runtime.audioContext.createScriptProcessor(4096, 1, 1);
    source.onaudioprocess = function(e) { player.writeSampleData(e); };
    source.connect(runtime.audioGain);
    runtime.notesPlaying.push(source);
    source.finished = function() {
        var i = runtime.notesPlaying.indexOf(source);
        if (i > -1 && runtime.notesPlaying[i] != null) {
            runtime.notesPlaying.splice(i, 1);
        }
    }
    window.setTimeout(source.finished, secs * 1000);
    return player;
};

var stopAllSounds = function() {
    var oldPlaying = runtime.audioPlaying;
    runtime.audioPlaying = [];
    for (var s = 0; s < oldPlaying.length; s++) {
        if (oldPlaying[s].source) {
            oldPlaying[s].source.noteOff(0);
            oldPlaying[s].source.finished();
        }
    }

    var oldPlaying = runtime.notesPlaying;
    runtime.notesPlaying = [];
    for (var s = 0; s < oldPlaying.length; s++) {
        if (oldPlaying[s]) {
            oldPlaying[s].disconnect();
            oldPlaying[s].finished();
        }
    }
};

SoundPrims.prototype.primPlaySound = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    var snd = s.soundNamed(interp.arg(b, 0));
    if (snd != null) playSound(snd);
};

SoundPrims.prototype.primPlaySoundUntilDone = function(b) {
    var activeThread = interp.activeThread;
    if (activeThread.firstTime) {
        var snd = interp.targetSprite().soundNamed(interp.arg(b, 0));
        if (snd == null) return;
        activeThread.tmpObj = playSound(snd);
        activeThread.firstTime = false;
    }
    var player = activeThread.tmpObj;
    if (player == null || player.done || player.playbackState == 3) {
        activeThread.tmpObj = null;
        activeThread.firstTime = true;
    } else {
        interp.yield = true;
    }
};

var beatsToSeconds = function(beats) {
    return beats * 60 / runtime.stage.data.tempoBPM;
};

SoundPrims.prototype.primPlayNote = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    if (interp.activeThread.firstTime) {
        var key = interp.numarg(b, 0);
        var secs = beatsToSeconds(interp.numarg(b, 1));
        playNote(s.instrument, key, secs, s);
        interp.startTimer(secs);
    } else {
        interp.checkTimer();
    }
};

SoundPrims.prototype.primPlayDrum = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    if (interp.activeThread.firstTime) {
        var drum = Math.round(interp.numarg(b, 0));
        var secs = beatsToSeconds(interp.numarg(b, 1));
        playDrum(drum, secs, s);
        interp.startTimer(secs);
    } else {
        interp.checkTimer();
    }
};

SoundPrims.prototype.primPlayRest = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    if (interp.activeThread.firstTime) {
        var secs = beatsToSeconds(interp.numarg(b, 0));
        interp.startTimer(secs);
    } else {
        interp.checkTimer();
    }
};

SoundPrims.prototype.primSetInstrument = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.instrument = interp.arg(b, 0);
};

SoundPrims.prototype.primStopAllSounds = function(b) {
    stopAllSounds();
};

SoundPrims.prototype.primChangeVolume = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.volume += interp.numarg(b, 0);
};

SoundPrims.prototype.primSetVolume = function(b) {
    var s = interp.targetSprite();
    if (s != null) s.volume = interp.numarg(b, 0);
};

SoundPrims.prototype.primVolume = function(b) {
    var s = interp.targetSprite();
    return s != null ? s.volume : 0;
};

module.exports = SoundPrims;
module.exports.stopAllSounds = stopAllSounds;

},{}],12:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

'use strict';

var VarListPrims = function() {}

VarListPrims.prototype.addPrimsTo = function(primTable) {
    // Variable primitives
    primTable['readVariable']        = this.primReadVar;
    primTable['setVar:to:']          = this.primSetVar;
    primTable['changeVar:by:']       = this.primChangeVar;
    primTable['hideVariable:']       = this.primHideVar;
    primTable['showVariable:']       = this.primShowVar;

    // List primitives
    primTable['contentsOfList:']      = this.primReadList;
    primTable['append:toList:']      = this.primListAppend;
    primTable['deleteLine:ofList:']  = this.primListDeleteLine;
    primTable['insert:at:ofList:']   = this.primListInsertAt;
    primTable['setLine:ofList:to:']  = this.primListSetLine;
    primTable['lineCountOfList:']    = this.primListLength;
    primTable['getLine:ofList:']     = this.primListGetLine;
    primTable['list:contains:']      = this.primListContains;
    primTable['hideList:']       = this.primHideList;
    primTable['showList:']       = this.primShowList;
};

// Variable primitive implementations

VarListPrims.prototype.primReadVar = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    var targetVar = interp.arg(b, 0);
    if (targetVar in s.variables) {
        return s.variables[targetVar];
    } else if (targetVar in runtime.stage.variables) {
        return runtime.stage.variables[targetVar];
    }
};

VarListPrims.prototype.primSetVar = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    var targetVar = interp.arg(b, 0);
    if (targetVar in s.variables) {
        s.variables[targetVar] = interp.arg(b, 1);
    } else if (targetVar in runtime.stage.variables) {
        runtime.stage.variables[targetVar] = interp.arg(b, 1);
    }
};

VarListPrims.prototype.primChangeVar = function(b) {
    var s = interp.targetSprite();
    if (s == null) return;
    var targetVar = interp.arg(b, 0);
    if (targetVar in s.variables) {
        s.variables[targetVar] = parseFloat(s.variables[targetVar]) + interp.numarg(b, 1);
    } else if (targetVar in runtime.stage.variables) {
        runtime.stage.variables[targetVar] = parseFloat(runtime.stage.variables[targetVar]) + interp.numarg(b, 1);
    }
};

VarListPrims.prototype.primHideVar = function(b) {
    var targetVar = interp.arg(b, 0), targetSprite = interp.targetSprite().objName;
    for (var r = 0; r < runtime.reporters.length; r++) {
        if (runtime.reporters[r].cmd == 'getVar:' && runtime.reporters[r].param == targetVar && (runtime.reporters[r].target == targetSprite || runtime.reporters[r].target == 'Stage')) {
            runtime.reporters[r].visible = false;
            return;
        }
    }
};

VarListPrims.prototype.primShowVar = function(b) {
    var targetVar = interp.arg(b, 0), targetSprite = interp.targetSprite().objName;
    for (var r = 0; r < runtime.reporters.length; r++) {
        if (runtime.reporters[r].cmd == 'getVar:' && runtime.reporters[r].param == targetVar && (runtime.reporters[r].target == targetSprite || runtime.reporters[r].target == 'Stage')) {
            runtime.reporters[r].visible = true;
            return;
        }
    }
};

// List primitive implementations

// Take a list name and target sprite and return the JS list itself
function findList(targetSprite, listName) {
    if (targetSprite == null) targetSprite = runtime.stage;
    if (listName in targetSprite.lists) {
        return targetSprite.lists[listName].contents;
    } else if (listName in runtime.stage.lists) {
        return runtime.stage.lists[listName].contents;
    }
    return null;
}

VarListPrims.prototype.primReadList = function(b) {
    var list = findList(interp.targetSprite(), interp.arg(b, 0));
    if (list) {
        var allOne = list.map(function(val) { return val.length; }).reduce(function(old,val) { return old + val; }, 0) === list.length;
        return list.join(allOne ? '' : ' ');
    }
};

VarListPrims.prototype.primListAppend = function(b) {
    var list = findList(interp.targetSprite(), interp.arg(b, 1));
    if (list) list.push(interp.arg(b, 0));
};

VarListPrims.prototype.primListDeleteLine = function(b) {
    var list = findList(interp.targetSprite(), interp.arg(b, 1));
    if (!list) return;
    var line = interp.arg(b, 0);
    if (line == 'all' || list.length == 0) {
        list.length = 0;
    } else if (line == 'last') {
        list.splice(list.length - 1, 1);
    } else if (parseInt(line, 10) - 1 in list) {
        list.splice(parseInt(line, 10) - 1, 1);
    }
};

VarListPrims.prototype.primListInsertAt = function(b) {
    var list = findList(interp.targetSprite(), interp.arg(b, 2));
    if (!list) return;
    var newItem = interp.arg(b, 0);

    var position = interp.arg(b, 1);
    if (position == 'last') {
        position = list.length;
    } else if (position == 'random') {
        position = Math.round(Math.random() * list.length);
    } else {
        position = parseInt(position, 10) - 1;
    }
    if (position > list.length) return;

    list.splice(position, 0, newItem);
};

VarListPrims.prototype.primListSetLine = function(b) {
    var list = findList(interp.targetSprite(), interp.arg(b, 1));
    if (!list) return;
    var newItem = interp.arg(b, 2);
    var position = interp.arg(b, 0);

    if (position == 'last') {
        position = list.length - 1;
    } else if (position == 'random') {
        position = Math.floor(Math.random() * list.length);
    } else {
        position = parseInt(position, 10) - 1;
    }

    if (position > list.length - 1) return;
    list[position] = newItem;
};

VarListPrims.prototype.primListLength = function(b) {
    var list = findList(interp.targetSprite(), interp.arg(b, 0));
    if (!list) return 0;
    return list.length;
};

VarListPrims.prototype.primListGetLine = function(b) {
    var list = findList(interp.targetSprite(), interp.arg(b, 1));
    if (!list) return 0;
    var line = interp.arg(b, 0);
    if (list.length == 0) return 0;
    if (line == 'random') line = Math.round(Math.random() * list.length);
    else if (line == 'last') line = list.length;
    else if (list.length < line) return 0;
    return list[line - 1];
};

VarListPrims.prototype.primListContains = function(b) {
    var list = findList(interp.targetSprite(), interp.arg(b, 0));
    if (!list) return 0;
    var searchItem = interp.arg(b, 1);
    if (parseFloat(searchItem) == searchItem) searchItem = parseFloat(searchItem);
    return $.inArray(searchItem, list) > -1;
};

VarListPrims.prototype.primHideList = function(b) {
    var targetList = interp.arg(b, 0), targetSprite = interp.targetSprite().objName;
    for (var r = 0; r < runtime.reporters.length; r++) {
        if (runtime.reporters[r] instanceof List && runtime.reporters[r].listName == targetList && (runtime.reporters[r].target == targetSprite || runtime.reporters[r].target == 'Stage')) {
            runtime.reporters[r].visible = false;
            return;
        }
    }
};

VarListPrims.prototype.primShowList = function(b) {
    var targetList = interp.arg(b, 0), targetSprite = interp.targetSprite().objName;
    for (var r = 0; r < runtime.reporters.length; r++) {
        if (runtime.reporters[r] instanceof List && runtime.reporters[r].listName == targetList && (runtime.reporters[r].target == targetSprite || runtime.reporters[r].target == 'Stage')) {
            runtime.reporters[r].visible = true;
            return;
        }
    }
};

module.exports = VarListPrims;

},{}],13:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// SoundDecoder.js
// Decode WAV Files (8-bit, 16-bit, and ADPCM) for playing by Sprites.
// For best performance, this should be run only once per WAV and
// the decoded buffer should be cached.

// Based almost entirely on John Maloney's AS implementation.

var WAVFile = _dereq_('./WAVFile');

var SoundDecoder = function(wavFileData) {
    this.scratchSound = null;

    this.soundData = null;
    this.startOffset = 0;
    this.endOffset = 0;
    this.stepSize = 0;
    this.adpcmBlockSize = 0;
    this.bytePosition = 0;
    this.soundChannel = null;
    this.lastBufferTime = 0;

    this.getSample = null;
    this.fraction = 0.0;
    this.thisSample = 0;

    // decoder state
    this.sample = 0;
    this.index = 0;
    this.lastByte = -1; // -1 indicates that there is no saved lastByte

    this.nextSample = 0;

    this.info = null;

    getSample = this.getSample16Uncompressed;
    if (wavFileData != null) {
        var info = WAVFile.decode(wavFileData);
        this.info = info;
        this.startOffset = info.sampleDataStart;
        this.endOffset = this.startOffset + info.sampleDataSize;
        this.soundData = new Uint8Array(wavFileData.slice(this.startOffset, this.endOffset));
        this.stepSize = info.samplesPerSecond / 44100.0;
        if (info.encoding == 17) {
            this.adpcmBlockSize = info.adpcmBlockSize;
            this.getSample = this.getSampleADPCM;
        } else {
            if (info.bitsPerSample == 8) this.getSample = this.getSample8Uncompressed;
            if (info.bitsPerSample == 16) this.getSample = this.getSample16Uncompressed;
        }
    }
};

SoundDecoder.prototype.noteFinished = function() {
    // Called by subclasses to force ending condition to be true in writeSampleData()
    this.bytePosition = this.endOffset;
};

// Used for Notes and Drums - Web Audio API ScriptProcessorNodes use this
// as a callback function to fill the buffers with sample data.
SoundDecoder.prototype.writeSampleData = function(evt) {
    var i = 0;
    var output = evt.outputBuffer.getChannelData(0);
    //this.updateVolume();
    for (i = 0; i < output.length; i++) {
        var n = this.interpolatedSample();
        output[i] = n;
    }
};

// For pre-caching the samples of WAV sounds
// Return a full list of samples generated by the decoder.
SoundDecoder.prototype.getAllSamples = function() {
    var samples = [], smp = 0;
    smp = this.interpolatedSample();
    while (smp != null) {
        samples.push(smp);
        smp = this.interpolatedSample();
    }
    return samples;
};

// Provide the next sample for the buffer
SoundDecoder.prototype.interpolatedSample = function() {
    this.fraction += this.stepSize;
    while (this.fraction >= 1.0) {
        this.thisSample = this.nextSample;
        this.nextSample = this.getSample();
        this.fraction -= 1.0;
    }
    if (this.nextSample == null) { return null; }
    var out = this.fraction == 0 ? this.thisSample : this.thisSample + this.fraction * (this.nextSample - this.thisSample);
    return out / 32768.0;
};

// 16-bit samples, big-endian
SoundDecoder.prototype.getSample16Uncompressed = function() {
    var result = 0;
    if (this.bytePosition <= (this.info.sampleDataSize - 2)) {
        result = (this.soundData[this.bytePosition + 1] << 8) + this.soundData[this.bytePosition];
        if (result > 32767) result -= 65536;
        this.bytePosition += 2;
    } else {
        this.bytePosition = this.endOffset;
        result = null;
    }
    return result;
};

// 8-bit samples, uncompressed
SoundDecoder.prototype.getSample8Uncompressed = function() {
    if (this.bytePosition >= this.info.sampleDataSize) return null;
    return (this.soundData[this.bytePosition++] - 128) << 8;
};

/*SoundDecoder.prototype.updateVolume = function() {
    if (this.client == null) {
        this.volume = 1.0;
        return;
    }
    if (this.client.volume == this.lastClientVolume) return; // optimization
    this.volume = Math.max(0.0, Math.min(this.client.volume / 100.0, 1.0));
    this.lastClientVolume = this.client.volume;
}*/

// Decoder for IMA ADPCM compressed sounds
SoundDecoder.indexTable = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

SoundDecoder.stepTable = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
    253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
    3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
    12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
];

SoundDecoder.prototype.getSampleADPCM = function() {
    // Decompress sample data using the IMA ADPCM algorithm.
    // Note: Handles only one channel, 4-bits/sample.
    var step = 0, code = 0, delta = 0;

    if (this.bytePosition % this.adpcmBlockSize == 0 && this.lastByte < 0) { // read block header
        if (this.bytePosition > this.info.sampleDataSize - 4) return null;
        this.sample = (this.soundData[this.bytePosition + 1] << 8) + this.soundData[this.bytePosition];
        if (this.sample > 32767) this.sample -= 65536;
        this.index = this.soundData[this.bytePosition + 2];
        this.bytePosition += 4;
        if (this.index > 88) this.index = 88;
        this.lastByte = -1;
        return this.sample;
    } else {
        // read 4-bit code and compute delta
        if (this.lastByte < 0) {
            if (this.bytePosition >= this.info.sampleDataSize) return null;
            this.lastByte = this.soundData[this.bytePosition++];
            code = this.lastByte & 0xF;
        } else {
            code = (this.lastByte >> 4) & 0xF;
            this.lastByte = -1;
        }
        step = SoundDecoder.stepTable[this.index];
        delta = 0;
        if (code & 4) delta += step;
        if (code & 2) delta += step >> 1;
        if (code & 1) delta += step >> 2;
        delta += step >> 3;
        // compute next index
        this.index += SoundDecoder.indexTable[code];
        if (this.index > 88) this.index = 88;
        if (this.index < 0) this.index = 0;
        // compute and output sample
        this.sample += code & 8 ? -delta : delta;
        if (this.sample > 32767) this.sample = 32767;
        if (this.sample < -32768) this.sample = -32768;
        return this.sample;
    }
}

module.exports = SoundDecoder;

},{"./WAVFile":14}],14:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// WAVFile.js
// Utility class for reading and decoding WAV file metadata
// Based directly on John Maloney's AS version for the Scratch Flash Player

var OffsetBuffer = _dereq_('../util/OffsetBuffer');

var WAVFile = function() {};

WAVFile.decode = function(waveData) {
    // Decode the given WAV file data and return an Object with the format and sample data.
    var result = {};

    var data = new OffsetBuffer(waveData);

    // read WAVE File Header
    if (data.readString(4) != 'RIFF') { console.log("WAVFile:  bad file header"); return; }
    var totalSize = data.readInt();
    if (data.getLength() != (totalSize + 8)) console.log("WAVFile: bad RIFF size; ignoring");
    if (data.readString(4) != 'WAVE') { console.log("WAVFile: not a WAVE file"); return; }

    // read format chunk
    var formatChunk = WAVFile.extractChunk('fmt ', data);
    if (formatChunk.getLength() < 16) { console.log("WAVFile: format chunk is too small"); return; }

    var encoding = formatChunk.readShort();
    result.encoding = encoding;
    result.channels = formatChunk.readShort();
    result.samplesPerSecond = formatChunk.readInt();
    result.bytesPerSecond = formatChunk.readInt();
    result.blockAlignment = formatChunk.readShort();
    result.bitsPerSample = formatChunk.readShort();

    // get size of data chunk
    var sampleDataStartAndSize = WAVFile.dataChunkStartAndSize(data);
    result.sampleDataStart = sampleDataStartAndSize[0];
    result.sampleDataSize = sampleDataStartAndSize[1];

    // handle various encodings
    if (encoding == 1) {
        if (!((result.bitsPerSample == 8) || (result.bitsPerSample == 16))) {
            console.log("WAVFile: can only handle 8-bit or 16-bit uncompressed PCM data");
            return;
        }
        result.sampleCount = result.sampleDataSize / 2;
    } else if (encoding == 17) {
        if (formatChunk.length < 20) { console.log("WAVFile: adpcm format chunk is too small"); return; }
        if (result.channels != 1) { console.log("WAVFile: adpcm supports only one channel (monophonic)"); return; }
        formatChunk.offset += 2;  // skip extra header byte count
        var samplesPerBlock = formatChunk.readShort();
        result.adpcmBlockSize = ((samplesPerBlock - 1) / 2) + 4; // block size in bytes
        var factChunk = WAVFile.extractChunk('fact', data);
        if ((factChunk != null) && (factChunk.getLength() == 4)) {
            result.sampleCount = factChunk.readInt();
        } else {
            // this should never happen, since there should always be a 'fact' chunk
            // slight over-estimate (doesn't take ADPCM headers into account)
            result.sampleCount = 2 * result.sampleDataSize;
        }
    } else {
        console.log("WAVFile: unknown encoding " + encoding);
        return;
    }
    return result;
};

WAVFile.extractChunk = function(desiredType, data) {
    // Return the contents of the first chunk of the given type or an empty OffsetBuffer if it is not found.
    data.offset = 12;
    while (data.bytesAvailable() > 8) {
        var chunkType = data.readString(4);
        var chunkSize = data.readUint();
        if (chunkType == desiredType) {
            if (chunkSize > data.bytesAvailable()) return null;
            var result = new OffsetBuffer(data.readBytes(chunkSize));
            return result;
        } else {
            data.offset += chunkSize;
        }
    }
    return new OffsetBuffer(new ArrayBuffer());
};

WAVFile.dataChunkStartAndSize = function(data) {
    // Return an array with the starting offset and size of the first chunk of the given type.
    data.offset = 12;
    while (data.bytesAvailable() >= 8) {
        var chunkType = data.readString(4);
        var chunkSize = data.readUint();
        if (chunkType == 'data') {
            if (chunkSize > data.bytesAvailable()) return [0, 0]; // bad wave file
            return [data.offset, chunkSize];
        } else {
            data.offset += chunkSize;
        }
    }
    return [0, 0]; // chunk not found; bad wave file
};

module.exports = WAVFile;

},{"../util/OffsetBuffer":16}],15:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// Color.js
// Based on the original by John Maloney

Color = function() {};

Color.fromHSV = function(h, s, v) {
    var r, g, b;
    h = h % 360;
    if (h < 0) h += 360;
    s = Math.max(0, Math.min(s, 1));
    v = Math.max(0, Math.min(v, 1));

    var i = Math.floor(h / 60);
    var f = (h / 60) - i;
    var p = v * (1 - s);
    var q = v * (1 - s * f);
    var t = v * (1 - s * (1 - f));
    if (i == 0) { r = v; g = t; b = p; }
    else if (i == 1) { r = q; g = v; b = p; }
    else if (i == 2) { r = p; g = v; b = t; }
    else if (i == 3) { r = p; g = q; b = v; }
    else if (i == 4) { r = t; g = p; b = v; }
    else if (i == 5) { r = v; g = p; b = q; }
    r = Math.floor(r * 255);
    g = Math.floor(g * 255);
    b = Math.floor(b * 255);
    return (r << 16) | (g << 8) | b;
};

Color.rgb2hsv = function(rgb) {
    var h, s, v, x, f, i;
    var r = ((rgb >> 16) & 255) / 255;
    var g = ((rgb >> 8) & 255) / 255;
    var b = (rgb & 255) / 255;
    x = Math.min(Math.min(r, g), b);
    v = Math.max(Math.max(r, g), b);
    if (x == v) return [0, 0, v]; // gray; hue arbitrarily reported as zero
    f = r == x ? g - b : g == x ? b - r : r - g;
    i = r == x ? 3 : g == x ? 5 : 1;
    h = ((i - f / (v - x)) * 60) % 360;
    s = (v - x) / v;
    return [h, s, v];
};

Color.scaleBrightness = function(rgb, scale) {
    var hsv = Color.rgb2hsv(rgb);
    scale = Math.max(0, Math.min(scale, 1));
    return Color.fromHSV(hsv[0], hsv[1], scale * hsv[2]);
};

Color.mixRGB = function(rgb1, rgb2, fraction) {
    // Mix rgb1 with rgb2. 0 gives all rgb1, 1 gives rbg2, .5 mixes them 50/50.
    if (fraction <= 0) return rgb1;
    if (fraction >= 1) return rgb2;
    var r1 = (rgb1 >> 16) & 255;
    var g1 = (rgb1 >> 8) & 255;
    var b1 = rgb1 & 255
    var r2 = (rgb2 >> 16) & 255;
    var g2 = (rgb2 >> 8) & 255;
    var b2 = rgb2 & 255
    var r = ((fraction * r2) + ((1.0 - fraction) * r1)) & 255;
    var g = ((fraction * g2) + ((1.0 - fraction) * g1)) & 255;
    var b = ((fraction * b2) + ((1.0 - fraction) * b1)) & 255;
    return (r << 16) | (g << 8) | b;
};

Color.random = function() {
    // return a random color
    var h = 360 * Math.random();
    var s = 0.7 + (0.3 * Math.random());
    var v = 0.6 + (0.4 * Math.random());
    return Color.fromHSV(h, s, v);
};

module.exports = Color;

},{}],16:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Provides the equivalent functionality of an AS ByteArray
// using JavaScript ArrayBuffers and viewers

var OffsetBuffer = function(data) {
    this.offset = 0;
    this.ab = data;
};

// Read various datatypes from the ArrayBuffer, seeking the offset.
OffsetBuffer.prototype.readString = function(length) {
    var str = this.ab2str(this.ab.slice(this.offset, this.offset + length));
    this.offset += length;
    return str;
};

OffsetBuffer.prototype.readInt = function() {
    var num = this.ab2int(this.ab.slice(this.offset, this.offset + 4));
    this.offset += 4;
    return num;
};

OffsetBuffer.prototype.readUint = function() {
    var num = this.ab2uint(this.ab.slice(this.offset, this.offset + 4));
    this.offset += 4;
    return num;
};

OffsetBuffer.prototype.readShort = function() {
    var num = this.ab2short(this.ab.slice(this.offset, this.offset + 2));
    this.offset += 2;
    return num;
};

OffsetBuffer.prototype.readBytes = function(length) {
    var bytes = this.ab.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
};

// Length of the internal buffer
OffsetBuffer.prototype.getLength = function() {
    return this.ab.byteLength;
};

// Number of bytes remaining from the current offset
OffsetBuffer.prototype.bytesAvailable = function() {
    return this.getLength() - this.offset;
};

// ArrayBuffer -> JS type conversion methods
OffsetBuffer.prototype.ab2str = function(buf) {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
};

// These create Javascript Numbers
OffsetBuffer.prototype.ab2int = function(buf) {
    return new Int32Array(buf)[0];
};

OffsetBuffer.prototype.ab2uint = function(buf) {
    return new Uint32Array(buf)[0];
};

OffsetBuffer.prototype.ab2short = function(buf) {
    return new Int16Array(buf)[0];
};

module.exports = OffsetBuffer;

},{}],17:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

var Point = function(x, y) {
    this.x = x;
    this.y = y;
};

var Rectangle = function(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.left = x;
    this.right = x + width;
    this.top = y;
    this.bottom = y + height;
};

Rectangle.prototype.intersects = function(other) {
    return !(this.left > other.right || this.right < other.left || this.top > other.bottom || this.bottom < other.top);
};

module.exports = Rectangle;

},{}],18:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

/*
*  Timer for the interpeter and performance testing
*  Tim Mickel, July 2011
*/
var Timer = function() {
    var trials = [];
    var last_trial = 0;
    var start_time = 0;
};

Timer.prototype.time = function() {
    return Date.now();
};

Timer.prototype.start = function() {
    start_time = this.time();
};

Timer.prototype.stop = function() {
    end = this.time();
    last_trial = end - start_time;
    trials.push(last_trial);
};

Timer.prototype.count = function() {
    return trials.length;
};

Timer.prototype.average = function() {
    sum = 0;
    for (i = 0; i < this.count(); i++) {
        sum += trials[i];
    }
    return sum / this.count();
};

Timer.prototype.print = function(element) {
    text = "Trial: " + last_trial + "ms" +
           "<br />\nTrials: " + this.count() + ", Avg: " + this.average() + "ms";
    if (element) {
        $(element).html(text);
    } else {
        console.log(text);
    }
};

module.exports = Timer;

},{}],19:[function(_dereq_,module,exports){
// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Instr.js
// Tim Mickel, 2013
// Based entirely on the AS by John Maloney, April 2012
//
// This class interacts with IO to load Scratch instruments and drums.
// The variable 'samples' is a dictionary of named sound buffers.
// Call initSamples() to initialize 'samples' before using (during load).
//
// All instrument and drum samples were created for Scratch by:
//
//      Paul Madden, paulmatthewmadden@yahoo.com
//
// Paul is an excellent sound designer and we appreciate all the effort
// he put into this project.

var Instr = function() {}

Instr.samples = {};
Instr.wavsLoaded = 0;

Instr.wavs = {
    'AcousticGuitar_F3': 'instruments/AcousticGuitar_F3_22k.wav',
    'AcousticPiano_As3': 'instruments/AcousticPiano(5)_A#3_22k.wav',
    'AcousticPiano_C4': 'instruments/AcousticPiano(5)_C4_22k.wav',
    'AcousticPiano_G4': 'instruments/AcousticPiano(5)_G4_22k.wav',
    'AcousticPiano_F5': 'instruments/AcousticPiano(5)_F5_22k.wav',
    'AcousticPiano_C6': 'instruments/AcousticPiano(5)_C6_22k.wav',
    'AcousticPiano_Ds6': 'instruments/AcousticPiano(5)_D#6_22k.wav',
    'AcousticPiano_D7': 'instruments/AcousticPiano(5)_D7_22k.wav',
    'AltoSax_A3': 'instruments/AltoSax_A3_22K.wav',
    'AltoSax_C6': 'instruments/AltoSax(3)_C6_22k.wav',
    'Bassoon_C3': 'instruments/Bassoon_C3_22k.wav',
    'BassTrombone_A2_2': 'instruments/BassTrombone_A2(2)_22k.wav',
    'BassTrombone_A2_3': 'instruments/BassTrombone_A2(3)_22k.wav',
    'Cello_C2': 'instruments/Cello(3b)_C2_22k.wav',
    'Cello_As2': 'instruments/Cello(3)_A#2_22k.wav',
    'Choir_F3': 'instruments/Choir(4)_F3_22k.wav',
    'Choir_F4': 'instruments/Choir(4)_F4_22k.wav',
    'Choir_F5': 'instruments/Choir(4)_F5_22k.wav',
    'Clarinet_C4': 'instruments/Clarinet_C4_22k.wav',
    'ElectricBass_G1': 'instruments/ElectricBass(2)_G1_22k.wav',
    'ElectricGuitar_F3': 'instruments/ElectricGuitar(2)_F3(1)_22k.wav',
    'ElectricPiano_C2': 'instruments/ElectricPiano_C2_22k.wav',
    'ElectricPiano_C4': 'instruments/ElectricPiano_C4_22k.wav',
    'EnglishHorn_D4': 'instruments/EnglishHorn(1)_D4_22k.wav',
    'EnglishHorn_F3': 'instruments/EnglishHorn(1)_F3_22k.wav',
    'Flute_B5_1': 'instruments/Flute(3)_B5(1)_22k.wav',
    'Flute_B5_2': 'instruments/Flute(3)_B5(2)_22k.wav',
    'Marimba_C4': 'instruments/Marimba_C4_22k.wav',
    'MusicBox_C4': 'instruments/MusicBox_C4_22k.wav',
    'Organ_G2': 'instruments/Organ(2)_G2_22k.wav',
    'Pizz_A3': 'instruments/Pizz(2)_A3_22k.wav',
    'Pizz_E4': 'instruments/Pizz(2)_E4_22k.wav',
    'Pizz_G2': 'instruments/Pizz(2)_G2_22k.wav',
    'SteelDrum_D5': 'instruments/SteelDrum_D5_22k.wav',
    'SynthLead_C4': 'instruments/SynthLead(6)_C4_22k.wav',
    'SynthLead_C6': 'instruments/SynthLead(6)_C6_22k.wav',
    'SynthPad_A3': 'instruments/SynthPad(2)_A3_22k.wav',
    'SynthPad_C6': 'instruments/SynthPad(2)_C6_22k.wav',
    'TenorSax_C3': 'instruments/TenorSax(1)_C3_22k.wav',
    'Trombone_B3': 'instruments/Trombone_B3_22k.wav',
    'Trumpet_E5': 'instruments/Trumpet_E5_22k.wav',
    'Vibraphone_C3': 'instruments/Vibraphone_C3_22k.wav',
    'Violin_D4': 'instruments/Violin(2)_D4_22K.wav',
    'Violin_A4': 'instruments/Violin(3)_A4_22k.wav',
    'Violin_E5': 'instruments/Violin(3b)_E5_22k.wav',
    'WoodenFlute_C5': 'instruments/WoodenFlute_C5_22k.wav',
    // Drums
    'BassDrum': 'drums/BassDrum(1b)_22k.wav',
    'Bongo': 'drums/Bongo_22k.wav',
    'Cabasa': 'drums/Cabasa(1)_22k.wav',
    'Clap': 'drums/Clap(1)_22k.wav',
    'Claves': 'drums/Claves(1)_22k.wav',
    'Conga': 'drums/Conga(1)_22k.wav',
    'Cowbell': 'drums/Cowbell(3)_22k.wav',
    'Crash': 'drums/Crash(2)_22k.wav',
    'Cuica': 'drums/Cuica(2)_22k.wav',
    'GuiroLong': 'drums/GuiroLong(1)_22k.wav',
    'GuiroShort': 'drums/GuiroShort(1)_22k.wav',
    'HiHatClosed': 'drums/HiHatClosed(1)_22k.wav',
    'HiHatOpen': 'drums/HiHatOpen(2)_22k.wav',
    'HiHatPedal': 'drums/HiHatPedal(1)_22k.wav',
    'Maracas': 'drums/Maracas(1)_22k.wav',
    'SideStick': 'drums/SideStick(1)_22k.wav',
    'SnareDrum': 'drums/SnareDrum(1)_22k.wav',
    'Tambourine': 'drums/Tambourine(3)_22k.wav',
    'Tom': 'drums/Tom(1)_22k.wav',
    'Triangle': 'drums/Triangle(1)_22k.wav',
    'Vibraslap': 'drums/Vibraslap(1)_22k.wav',
    'WoodBlock': 'drums/WoodBlock(1)_22k.wav'
};

Instr.wavCount = Object.keys(Instr.wavs).length;

module.exports = Instr;

},{}]},{},[4])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlcyI6WyIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL1VzZXJzL2NocmlzL1NpdGVzL3NjcmF0Y2gtaHRtbDUvanMvSU8uanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9qcy9JbnRlcnByZXRlci5qcyIsIi9Vc2Vycy9jaHJpcy9TaXRlcy9zY3JhdGNoLWh0bWw1L2pzL1J1bnRpbWUuanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9qcy9TY3JhdGNoLmpzIiwiL1VzZXJzL2NocmlzL1NpdGVzL3NjcmF0Y2gtaHRtbDUvanMvU3ByaXRlLmpzIiwiL1VzZXJzL2NocmlzL1NpdGVzL3NjcmF0Y2gtaHRtbDUvanMvU3RhZ2UuanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9qcy9wcmltaXRpdmVzL0xvb2tzUHJpbXMuanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9qcy9wcmltaXRpdmVzL01vdGlvbkFuZFBlblByaW1zLmpzIiwiL1VzZXJzL2NocmlzL1NpdGVzL3NjcmF0Y2gtaHRtbDUvanMvcHJpbWl0aXZlcy9QcmltaXRpdmVzLmpzIiwiL1VzZXJzL2NocmlzL1NpdGVzL3NjcmF0Y2gtaHRtbDUvanMvcHJpbWl0aXZlcy9TZW5zaW5nUHJpbXMuanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9qcy9wcmltaXRpdmVzL1NvdW5kUHJpbXMuanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9qcy9wcmltaXRpdmVzL1Zhckxpc3RQcmltcy5qcyIsIi9Vc2Vycy9jaHJpcy9TaXRlcy9zY3JhdGNoLWh0bWw1L2pzL3NvdW5kL1NvdW5kRGVjb2Rlci5qcyIsIi9Vc2Vycy9jaHJpcy9TaXRlcy9zY3JhdGNoLWh0bWw1L2pzL3NvdW5kL1dBVkZpbGUuanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9qcy91dGlsL0NvbG9yLmpzIiwiL1VzZXJzL2NocmlzL1NpdGVzL3NjcmF0Y2gtaHRtbDUvanMvdXRpbC9PZmZzZXRCdWZmZXIuanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9qcy91dGlsL1JlY3RhbmdsZS5qcyIsIi9Vc2Vycy9jaHJpcy9TaXRlcy9zY3JhdGNoLWh0bWw1L2pzL3V0aWwvVGltZXIuanMiLCIvVXNlcnMvY2hyaXMvU2l0ZXMvc2NyYXRjaC1odG1sNS9zb3VuZGJhbmsvSW5zdHIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2haQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqa0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDelFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25GQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3Rocm93IG5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIil9dmFyIGY9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGYuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sZixmLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuLy8gU2NyYXRjaCBIVE1MNSBQbGF5ZXJcbi8vIElPLmpzXG4vLyBUaW0gTWlja2VsLCBNYXJjaCAyMDEyXG5cbi8vIElPIGhhbmRsZXMgSlNPTiBjb21tdW5pY2F0aW9uIGFuZCBwcm9jZXNzaW5nLlxuLy8gV2UgbWFrZSB0aGUgc3ByaXRlcyBhbmQgdGhyZWFkcyBoZXJlLlxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBJbnN0ciA9IHJlcXVpcmUoJy4uL3NvdW5kYmFuay9JbnN0cicpLFxuICAgIFdBVkZpbGUgPSByZXF1aXJlKCcuL3NvdW5kL1dBVkZpbGUnKSxcbiAgICBTb3VuZERlY29kZXIgPSByZXF1aXJlKCcuL3NvdW5kL1NvdW5kRGVjb2RlcicpLFxuICAgIFN0YWdlID0gcmVxdWlyZSgnLi9TdGFnZScpLFxuICAgIFNwcml0ZSA9IHJlcXVpcmUoJy4vU3ByaXRlJyksXG4gICAgT2Zmc2V0QnVmZmVyID0gcmVxdWlyZSgnLi91dGlsL09mZnNldEJ1ZmZlcicpO1xuXG52YXIgSU8gPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRhdGEgPSBudWxsO1xuICAgIC8vIEluIHByb2R1Y3Rpb24sIHNpbXBseSB1c2UgdGhlIGxvY2FsIHBhdGggKG5vIHByb3h5KVxuICAgIC8vIHNpbmNlIHdlIHdvbid0IGJlIGhhbXBlcmVkIGJ5IHRoZSBzYW1lLW9yaWdpbiBwb2xpY3kuXG4gICAgdGhpcy5iYXNlID0gJ3Byb3h5LnBocD9yZXNvdXJjZT1pbnRlcm5hbGFwaS8nO1xuICAgIC8vdGhpcy5iYXNlID0gJ2h0dHA6Ly9zY3JhdGNoLm1pdC5lZHUvaW50ZXJuYWxhcGkvJzsgLy8gRmluYWwgYmFzZVxuICAgIHRoaXMucHJvamVjdF9iYXNlID0gJ2h0dHA6Ly9wcm9qZWN0cy5zY3JhdGNoLm1pdC5lZHUvaW50ZXJuYWxhcGkvcHJvamVjdC8nO1xuICAgIHRoaXMucHJvamVjdF9zdWZmaXggPSAnL2dldC8nO1xuICAgIHRoaXMuYXNzZXRfYmFzZSA9ICdodHRwOi8vY2RuLnNjcmF0Y2gubWl0LmVkdS9pbnRlcm5hbGFwaS9hc3NldC8nO1xuICAgIHRoaXMuYXNzZXRfc3VmZml4ID0gJy9nZXQvJztcbiAgICB0aGlzLnNvdW5kYmFua19iYXNlID0gJ3NvdW5kYmFuay8nO1xuICAgIHRoaXMuc3ByaXRlTGF5ZXJDb3VudCA9IDA7XG59O1xuXG5JTy5wcm90b3R5cGUubG9hZFByb2plY3QgPSBmdW5jdGlvbihwcm9qZWN0X2lkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICQuZ2V0SlNPTih0aGlzLnByb2plY3RfYmFzZSArIHByb2plY3RfaWQgKyB0aGlzLnByb2plY3Rfc3VmZml4LCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgICAgIHNlbGYubWFrZU9iamVjdHMoKTtcbiAgICAgICAgc2VsZi5sb2FkVGhyZWFkcygpO1xuICAgICAgICBzZWxmLmxvYWROb3Rlc0RydW1zKCk7XG4gICAgICAgIHJ1bnRpbWUubG9hZFN0YXJ0KCk7IC8vIFRyeSB0byBydW4gdGhlIHByb2plY3QuXG4gICAgfSk7XG59O1xuXG5JTy5wcm90b3R5cGUuc291bmRSZXF1ZXN0ID0gZnVuY3Rpb24oc291bmQsIHNwcml0ZSkge1xuICAgIHZhciByZXF1ZXN0ID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG4gICAgcmVxdWVzdC5vcGVuKCdHRVQnLCB0aGlzLmFzc2V0X2Jhc2UgKyBzb3VuZFsnbWQ1J10gKyB0aGlzLmFzc2V0X3N1ZmZpeCwgdHJ1ZSk7XG4gICAgcmVxdWVzdC5yZXNwb25zZVR5cGUgPSAnYXJyYXlidWZmZXInO1xuICAgIHJlcXVlc3Qub25sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciB3YXZlRGF0YSA9IHJlcXVlc3QucmVzcG9uc2U7XG4gICAgICAgIC8vIERlY29kZSB0aGUgd2F2ZURhdGEgYW5kIHBvcHVsYXRlIGEgYnVmZmVyIGNoYW5uZWwgd2l0aCB0aGUgc2FtcGxlc1xuICAgICAgICB2YXIgc25kID0gbmV3IFNvdW5kRGVjb2Rlcih3YXZlRGF0YSk7XG4gICAgICAgIHZhciBzYW1wbGVzID0gc25kLmdldEFsbFNhbXBsZXMoKTtcbiAgICAgICAgc291bmQuYnVmZmVyID0gcnVudGltZS5hdWRpb0NvbnRleHQuY3JlYXRlQnVmZmVyKDEsIHNhbXBsZXMubGVuZ3RoLCBydW50aW1lLmF1ZGlvQ29udGV4dC5zYW1wbGVSYXRlKTtcbiAgICAgICAgdmFyIGRhdGEgPSBzb3VuZC5idWZmZXIuZ2V0Q2hhbm5lbERhdGEoMCk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZGF0YS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgZGF0YVtpXSA9IHNhbXBsZXNbaV07XG4gICAgICAgIH1cbiAgICAgICAgc3ByaXRlLnNvdW5kc0xvYWRlZCsrO1xuICAgIH07XG4gICAgcmVxdWVzdC5zZW5kKCk7XG59O1xuXG5JTy5wcm90b3R5cGUubG9hZE5vdGVzRHJ1bXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgJC5lYWNoKEluc3RyLndhdnMsIGZ1bmN0aW9uKG5hbWUsIGZpbGUpIHtcbiAgICAgICAgdmFyIHJlcXVlc3QgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbiAgICAgICAgcmVxdWVzdC5vcGVuKCdHRVQnLCBzZWxmLnNvdW5kYmFua19iYXNlICsgZXNjYXBlKGZpbGUpLCB0cnVlKTtcbiAgICAgICAgcmVxdWVzdC5yZXNwb25zZVR5cGUgPSAnYXJyYXlidWZmZXInO1xuICAgICAgICByZXF1ZXN0Lm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHdhdmVEYXRhID0gbmV3IE9mZnNldEJ1ZmZlcihyZXF1ZXN0LnJlc3BvbnNlKTtcbiAgICAgICAgICAgIC8vIERlY29kZSB0aGUgd2F2ZURhdGEgYW5kIHBvcHVsYXRlIGEgYnVmZmVyIGNoYW5uZWwgd2l0aCB0aGUgc2FtcGxlc1xuICAgICAgICAgICAgdmFyIGluZm8gPSBXQVZGaWxlLmRlY29kZShyZXF1ZXN0LnJlc3BvbnNlKTtcbiAgICAgICAgICAgIHdhdmVEYXRhLm9mZnNldCA9IGluZm8uc2FtcGxlRGF0YVN0YXJ0O1xuICAgICAgICAgICAgdmFyIHNvdW5kQnVmZmVyID0gd2F2ZURhdGEucmVhZEJ5dGVzKDIgKiBpbmZvLnNhbXBsZUNvdW50KTtcbiAgICAgICAgICAgIEluc3RyLnNhbXBsZXNbbmFtZV0gPSBzb3VuZEJ1ZmZlcjtcbiAgICAgICAgICAgIEluc3RyLndhdnNMb2FkZWQrKztcbiAgICAgICAgfTtcbiAgICAgICAgcmVxdWVzdC5zZW5kKCk7XG4gICAgfSk7XG59O1xuXG5JTy5wcm90b3R5cGUubWFrZU9iamVjdHMgPSBmdW5jdGlvbigpIHtcbiAgICAvLyBDcmVhdGUgdGhlIHN0YWdlXG4gICAgcnVudGltZS5zdGFnZSA9IG5ldyBTdGFnZSh0aGlzLmRhdGEpO1xuICAgIHJ1bnRpbWUuc3RhZ2UuYXR0YWNoKHJ1bnRpbWUuc2NlbmUpO1xuICAgIHJ1bnRpbWUuc3RhZ2UuYXR0YWNoUGVuTGF5ZXIocnVudGltZS5zY2VuZSk7XG4gICAgcnVudGltZS5zdGFnZS5sb2FkU291bmRzKCk7XG4gICAgLy8gQ3JlYXRlIHRoZSBzcHJpdGVzIGFuZCB3YXRjaGVyc1xuICAgIGZ1bmN0aW9uIGNyZWF0ZU9iaihvYmosIHNwcml0ZSkge1xuICAgICAgICB2YXIgbmV3U3ByaXRlO1xuICAgICAgICBmdW5jdGlvbiBjcmVhdGVTcHJpdGUob2JqKSB7XG4gICAgICAgICAgICB2YXIgbmV3U3ByaXRlID0gbmV3IFNwcml0ZShvYmopO1xuICAgICAgICAgICAgbmV3U3ByaXRlLmxvYWRTb3VuZHMoKTtcbiAgICAgICAgICAgIHJldHVybiBuZXdTcHJpdGU7XG4gICAgICAgIH1cbiAgICAgICAgZnVuY3Rpb24gY3JlYXRlUmVwb3J0ZXIob2JqLCBzcHJpdGUpIHtcbiAgICAgICAgICAgIHZhciBuZXdTcHJpdGU7XG4gICAgICAgICAgICBpZiAob2JqLmxpc3ROYW1lKSB7IC8vIGxpc3RcbiAgICAgICAgICAgICAgICBpZiAoIShzcHJpdGU9PT1ydW50aW1lLnN0YWdlICYmICFydW50aW1lLnN0YWdlLmxpc3RzW29iai5saXN0TmFtZV0pKSB7IC8vIGZvciBsb2NhbCBsaXN0cywgb25seSBpZiBpbiBzcHJpdGVcbiAgICAgICAgICAgICAgICAgICAgbmV3U3ByaXRlID0gbmV3IExpc3Qob2JqLCBzcHJpdGUub2JqTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgIHJ1bnRpbWUucmVwb3J0ZXJzLnB1c2gobmV3U3ByaXRlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5ld1Nwcml0ZSA9IG5ldyBSZXBvcnRlcihvYmopO1xuICAgICAgICAgICAgICAgIHJ1bnRpbWUucmVwb3J0ZXJzLnB1c2gobmV3U3ByaXRlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBuZXdTcHJpdGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9iai5vYmpOYW1lKSB7IC8vIHNwcml0ZVxuICAgICAgICAgICAgbmV3U3ByaXRlID0gY3JlYXRlU3ByaXRlKG9iaik7XG4gICAgICAgICAgICBzcHJpdGUgPSBuZXdTcHJpdGU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBuZXdTcHJpdGUgPSBjcmVhdGVSZXBvcnRlcihvYmosIHNwcml0ZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG5ld1Nwcml0ZSkge1xuICAgICAgICAgICAgcnVudGltZS5zcHJpdGVzLnB1c2gobmV3U3ByaXRlKTtcbiAgICAgICAgICAgIG5ld1Nwcml0ZS5hdHRhY2gocnVudGltZS5zY2VuZSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgJC5lYWNoKHRoaXMuZGF0YS5jaGlsZHJlbiwgZnVuY3Rpb24oaW5kZXgsIG9iaikge1xuICAgICAgICBjcmVhdGVPYmoob2JqLCBydW50aW1lLnN0YWdlKTsgLy8gY3JlYXRlIGNoaWxkcmVuIG9mIHN0YWdlIC0gc3ByaXRlcywgd2F0Y2hlcnMsIGFuZCBzdGFnZSdzIGxpc3RzXG4gICAgfSk7XG4gICAgJC5lYWNoKHJ1bnRpbWUuc3ByaXRlcy5maWx0ZXIoZnVuY3Rpb24oc3ByaXRlKSB7cmV0dXJuIHNwcml0ZSBpbnN0YW5jZW9mIFNwcml0ZX0pLCBmdW5jdGlvbihpbmRleCwgc3ByaXRlKSB7IC8vIGxpc3Qgb2Ygc3ByaXRlc1xuICAgICAgICAkLmVhY2goc3ByaXRlLmxpc3RzLCBmdW5jdGlvbihpbmRleCwgbGlzdCkge1xuICAgICAgICAgICAgY3JlYXRlT2JqKGxpc3QsIHNwcml0ZSk7IC8vIGNyZWF0ZSBsb2NhbCBsaXN0c1xuICAgICAgICB9KTtcbiAgICB9KTtcbn07XG5cbklPLnByb3RvdHlwZS5sb2FkVGhyZWFkcyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB0YXJnZXQgPSBydW50aW1lLnN0YWdlO1xuICAgIHZhciBzY3JpcHRzID0gdGFyZ2V0LmRhdGEuc2NyaXB0cztcbiAgICBpZiAoc2NyaXB0cykge1xuICAgICAgICBmb3IgKHZhciBzIGluIHNjcmlwdHMpIHtcbiAgICAgICAgICAgIHRhcmdldC5zdGFja3MucHVzaChpbnRlcnAubWFrZUJsb2NrTGlzdChzY3JpcHRzW3NdWzJdKSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgJC5lYWNoKHRoaXMuZGF0YS5jaGlsZHJlbiwgZnVuY3Rpb24oaW5kZXgsIG9iaikge1xuICAgICAgICB0YXJnZXQgPSBydW50aW1lLnNwcml0ZXNbaW5kZXhdO1xuICAgICAgICBpZiAodHlwZW9mKHRhcmdldCkgIT0gJ3VuZGVmaW5lZCcgJiYgdGFyZ2V0LmRhdGEgJiYgdGFyZ2V0LmRhdGEuc2NyaXB0cykge1xuICAgICAgICAgICAgJC5lYWNoKHRhcmdldC5kYXRhLnNjcmlwdHMsIGZ1bmN0aW9uKGosIHMpIHtcbiAgICAgICAgICAgICAgICB0YXJnZXQuc3RhY2tzLnB1c2goaW50ZXJwLm1ha2VCbG9ja0xpc3Qoc1syXSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9KTtcbn07XG5cbi8vIFJldHVybnMgdGhlIG51bWJlciBzcHJpdGUgd2UgYXJlIHJlbmRlcmluZ1xuLy8gdXNlZCBmb3IgaW5pdGlhbCBsYXllcmluZyBhc3NpZ25tZW50XG5JTy5wcm90b3R5cGUuZ2V0Q291bnQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcnYgPSB0aGlzLnNwcml0ZUxheWVyQ291bnQ7XG4gICAgdGhpcy5zcHJpdGVMYXllckNvdW50Kys7XG4gICAgcmV0dXJuIHJ2O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBJTztcbiIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuLy8gU2NyYXRjaCBIVE1MNSBQbGF5ZXJcbi8vIEludGVycHJldGVyLmpzXG4vLyBUaW0gTWlja2VsLCBKdWx5IDIwMTFcbi8vIEJhc2VkIG9uIHRoZSBvcmlnaW5hbCBieSBKb2huIE1hbG9uZXlcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgUHJpbWl0aXZlcyA9IHJlcXVpcmUoJy4vcHJpbWl0aXZlcy9QcmltaXRpdmVzJyksXG4gICAgVGltZXIgPSByZXF1aXJlKCcuL3V0aWwvVGltZXInKTtcblxudmFyIEJsb2NrID0gZnVuY3Rpb24ob3BBbmRBcmdzLCBvcHRpb25hbFN1YnN0YWNrKSB7XG4gICAgdGhpcy5vcCA9IG9wQW5kQXJnc1swXTtcbiAgICB0aGlzLnByaW1GY24gPSBpbnRlcnAubG9va3VwUHJpbSh0aGlzLm9wKTtcbiAgICB0aGlzLmFyZ3MgPSBvcEFuZEFyZ3Muc2xpY2UoMSk7IC8vIGFyZ3VtZW50cyBjYW4gYmUgZWl0aGVyIG9yIGNvbnN0YW50cyAobnVtYmVycywgYm9vbGVhbiBzdHJpbmdzLCBldGMuKSBvciBleHByZXNzaW9ucyAoQmxvY2tzKVxuICAgIHRoaXMuaXNMb29wID0gZmFsc2U7IC8vIHNldCB0byB0cnVlIGZvciBsb29wIGJsb2NrcyB0aGUgZmlyc3QgdGltZSB0aGV5IHJ1blxuICAgIHRoaXMuc3Vic3RhY2sgPSBvcHRpb25hbFN1YnN0YWNrO1xuICAgIHRoaXMuc3ViU3RhY2syID0gbnVsbDtcbiAgICB0aGlzLm5leHRCbG9jayA9IG51bGw7XG4gICAgdGhpcy50bXAgPSAtMTtcbiAgICBpbnRlcnAuZml4QXJncyh0aGlzKTtcbn07XG5cbnZhciBUaHJlYWQgPSBmdW5jdGlvbihibG9jaywgdGFyZ2V0KSB7XG4gICAgdGhpcy5uZXh0QmxvY2sgPSBibG9jazsgLy8gbmV4dCBibG9jayB0byBydW47IG51bGwgd2hlbiB0aHJlYWQgaXMgZmluaXNoZWRcbiAgICB0aGlzLmZpcnN0QmxvY2sgPSBibG9jaztcbiAgICB0aGlzLnN0YWNrID0gW107IC8vIHN0YWNrIG9mIGVuY2xvc2luZyBjb250cm9sIHN0cnVjdHVyZSBibG9ja3NcbiAgICB0aGlzLnRhcmdldCA9IHRhcmdldDsgLy8gdGFyZ2V0IG9iamVjdCBydW5uaW5nIHRoZSB0aHJlYWRcbiAgICB0aGlzLnRtcCA9IG51bGw7IC8vIHVzZWQgZm9yIHRocmVhZCBvcGVyYXRpb25zIGxpa2UgVGltZXJcbiAgICB0aGlzLnRtcE9iaiA9IFtdOyAvLyB1c2VkIGZvciBTcHJpdGUgb3BlcmF0aW9ucyBsaWtlIGdsaWRlXG4gICAgdGhpcy5maXJzdFRpbWUgPSB0cnVlO1xuICAgIHRoaXMucGF1c2VkID0gZmFsc2U7XG59O1xuXG52YXIgSW50ZXJwcmV0ZXIgPSBmdW5jdGlvbigpIHtcbiAgICAvLyBJbnRlcnByZXRlciBzdGF0ZVxuICAgIHRoaXMucHJpbWl0aXZlVGFibGUgPSB7fVxuICAgIHRoaXMudmFyaWFibGVzID0ge307XG4gICAgdGhpcy50aHJlYWRzID0gW107XG4gICAgdGhpcy5hY3RpdmVUaHJlYWQgPSBuZXcgVGhyZWFkKG51bGwpO1xuICAgIHRoaXMuV29ya1RpbWUgPSAzMDtcbiAgICB0aGlzLmN1cnJlbnRNU2VjcyA9IG51bGw7XG4gICAgdGhpcy50aW1lciA9IG5ldyBUaW1lcigpO1xuICAgIHRoaXMueWllbGQgPSBmYWxzZTtcbiAgICB0aGlzLmRvUmVkcmF3ID0gZmFsc2U7XG4gICAgdGhpcy5vcENvdW50ID0gMDsgLy8gdXNlZCB0byBiZW5jaG1hcmsgdGhlIGludGVycHJldGVyXG4gICAgdGhpcy5kZWJ1Z09wcyA9IGZhbHNlO1xuICAgIHRoaXMuZGVidWdGdW5jID0gbnVsbDtcbiAgICB0aGlzLm9wQ291bnQyID0gMDtcbn07XG5cbi8vIFV0aWxpdGllcyBmb3IgYnVpbGRpbmcgYmxvY2tzIGFuZCBzZXF1ZW5jZXMgb2YgYmxvY2tzXG5JbnRlcnByZXRlci5wcm90b3R5cGUuZml4QXJncyA9IGZ1bmN0aW9uKGIpIHtcbiAgICAvLyBDb252ZXJ0IHRoZSBhcmd1bWVudHMgb2YgdGhlIGdpdmVuIGJsb2NrIGludG8gYmxvY2tzIG9yIHN1YnN0YWNrcyBpZiBuZWNlc3NhcnkuXG4gICAgLy8gQSBibG9jayBhcmd1bWVudCBjYW4gYmUgYSBjb25zdGFudCAobnVtYmVycywgYm9vbGVhbiBzdHJpbmdzLCBldGMuKSwgYW4gZXhwcmVzc2lvbiAoQmxvY2tzKSwgb3IgYSBzdWJzdGFjayAoYW4gYXJyYXkgb2YgYmxvY2tzKS5cbiAgICB2YXIgbmV3QXJncyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYi5hcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBhcmcgPSBiLmFyZ3NbaV07XG4gICAgICAgIGlmIChhcmcgJiYgYXJnLmNvbnN0cnVjdG9yID09IEFycmF5KSB7XG4gICAgICAgICAgICBpZiAoKGFyZy5sZW5ndGggPiAwKSAmJiAoYXJnWzBdLmNvbnN0cnVjdG9yID09IEFycmF5KSkge1xuICAgICAgICAgICAgICAgIC8vIGlmIGZpcnN0IGVsZW1lbnQgYXJnIGlzIGl0c2VsZiBhbiBhcnJheSwgdGhlbiBhcmcgaXMgYSBzdWJzdGFja1xuICAgICAgICAgICAgICAgIGlmICghYi5zdWJzdGFjaykge1xuICAgICAgICAgICAgICAgICAgICBiLnN1YnN0YWNrID0gdGhpcy5tYWtlQmxvY2tMaXN0KGFyZyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgYi5zdWJzdGFjazIgPSB0aGlzLm1ha2VCbG9ja0xpc3QoYXJnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIGFyZyBpcyBhIGJsb2NrXG4gICAgICAgICAgICAgICAgbmV3QXJncy5wdXNoKG5ldyBCbG9jayhhcmcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5ld0FyZ3MucHVzaChhcmcpOyAvLyBhcmcgaXMgYSBjb25zdGFudFxuICAgICAgICB9XG4gICAgfVxuICAgIGIuYXJncyA9IG5ld0FyZ3M7XG59O1xuXG5JbnRlcnByZXRlci5wcm90b3R5cGUubWFrZUJsb2NrTGlzdCA9IGZ1bmN0aW9uKGJsb2NrTGlzdCkge1xuICAgIHZhciBmaXJzdEJsb2NrID0gbnVsbCwgbGFzdEJsb2NrID0gbnVsbDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGJsb2NrTGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgYiA9IG5ldyBCbG9jayhibG9ja0xpc3RbaV0pO1xuICAgICAgICBpZiAoZmlyc3RCbG9jayA9PSBudWxsKSBmaXJzdEJsb2NrID0gYjtcbiAgICAgICAgaWYgKGxhc3RCbG9jaykgbGFzdEJsb2NrLm5leHRCbG9jayA9IGI7XG4gICAgICAgIGxhc3RCbG9jayA9IGI7XG4gICAgfVxuICAgIHJldHVybiBmaXJzdEJsb2NrO1xufTtcblxuLy8gVGhlIEludGVycHJldGVyIHByb3BlclxuSW50ZXJwcmV0ZXIucHJvdG90eXBlLnN0ZXBUaHJlYWRzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0YXJ0VGltZTtcbiAgICBzdGFydFRpbWUgPSB0aGlzLmN1cnJlbnRNU2VjcyA9IHRoaXMudGltZXIudGltZSgpO1xuICAgIHRoaXMuZG9SZWRyYXcgPSBmYWxzZTtcbiAgICBpZiAodGhpcy50aHJlYWRzLmxlbmd0aCA9PSAwKSByZXR1cm47XG5cbiAgICB3aGlsZSAoKHRoaXMuY3VycmVudE1TZWNzIC0gc3RhcnRUaW1lKSA8IHRoaXMuV29ya1RpbWUgJiYgIXRoaXMuZG9SZWRyYXcpIHtcbiAgICAgICAgdmFyIHRocmVhZFN0b3BwZWQgPSBmYWxzZTtcbiAgICAgICAgZm9yICh2YXIgYSA9IHRoaXMudGhyZWFkcy5sZW5ndGgtMTsgYSA+PSAwOyAtLWEpIHtcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlVGhyZWFkID0gdGhpcy50aHJlYWRzW2FdO1xuICAgICAgICAgICAgdGhpcy5zdGVwQWN0aXZlVGhyZWFkKCk7XG4gICAgICAgICAgICBpZiAoIXRoaXMuYWN0aXZlVGhyZWFkIHx8IHRoaXMuYWN0aXZlVGhyZWFkLm5leHRCbG9jayA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgdGhyZWFkU3RvcHBlZCA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRocmVhZFN0b3BwZWQpIHtcbiAgICAgICAgICAgIHZhciBuZXdUaHJlYWRzID0gW107XG4gICAgICAgICAgICBmb3IgKHZhciBhID0gdGhpcy50aHJlYWRzLmxlbmd0aC0xOyBhID49IDA7IC0tYSkge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLnRocmVhZHNbYV0ubmV4dEJsb2NrICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgbmV3VGhyZWFkcy5wdXNoKHRoaXMudGhyZWFkc1thXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy50aHJlYWRzID0gbmV3VGhyZWFkcztcbiAgICAgICAgICAgIGlmICh0aGlzLnRocmVhZHMubGVuZ3RoID09IDApIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmN1cnJlbnRNU2VjcyA9IHRoaXMudGltZXIudGltZSgpO1xuICAgIH1cbn07XG5cbkludGVycHJldGVyLnByb3RvdHlwZS5zdGVwQWN0aXZlVGhyZWFkID0gZnVuY3Rpb24oKSB7XG4gICAgLy8gUnVuIHRoZSBhY3RpdmUgdGhyZWFkIHVudGlsIGl0IHlpZWxkcy5cbiAgICBpZiAodHlwZW9mKHRoaXMuYWN0aXZlVGhyZWFkKSA9PSAndW5kZWZpbmVkJykge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBiID0gdGhpcy5hY3RpdmVUaHJlYWQubmV4dEJsb2NrO1xuICAgIGlmIChiID09IG51bGwpIHJldHVybjtcbiAgICB0aGlzLnlpZWxkID0gZmFsc2U7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgaWYgKHRoaXMuYWN0aXZlVGhyZWFkLnBhdXNlZCkgcmV0dXJuO1xuXG4gICAgICAgICsrdGhpcy5vcENvdW50O1xuICAgICAgICAvLyBBZHZhbmNlIHRoZSBcInByb2dyYW0gY291bnRlclwiIHRvIHRoZSBuZXh0IGJsb2NrIGJlZm9yZSBydW5uaW5nIHRoZSBwcmltaXRpdmUuXG4gICAgICAgIC8vIENvbnRyb2wgZmxvdyBwcmltaXRpdmVzIChlLmcuIGlmKSBtYXkgY2hhbmdlIGFjdGl2ZVRocmVhZC5uZXh0QmxvY2suXG4gICAgICAgIHRoaXMuYWN0aXZlVGhyZWFkLm5leHRCbG9jayA9IGIubmV4dEJsb2NrO1xuICAgICAgICBpZiAodGhpcy5kZWJ1Z09wcyAmJiB0aGlzLmRlYnVnRnVuYykge1xuICAgICAgICAgICAgdmFyIGZpbmFsQXJncyA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBiLmFyZ3MubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgICAgICAgICBmaW5hbEFyZ3MucHVzaCh0aGlzLmFyZyhiLCBpKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuZGVidWdGdW5jKHRoaXMub3BDb3VudDIsIGIub3AsIGZpbmFsQXJncyk7XG4gICAgICAgICAgICArK3RoaXMub3BDb3VudDI7XG4gICAgICAgIH1cbiAgICAgICAgYi5wcmltRmNuKGIpO1xuICAgICAgICBpZiAodGhpcy55aWVsZCkgeyB0aGlzLmFjdGl2ZVRocmVhZC5uZXh0QmxvY2sgPSBiOyByZXR1cm47IH1cbiAgICAgICAgYiA9IHRoaXMuYWN0aXZlVGhyZWFkLm5leHRCbG9jazsgLy8gcmVmcmVzaCBsb2NhbCB2YXJpYWJsZSBiIGluIGNhc2UgcHJpbWl0aXZlIGRpZCBzb21lIGNvbnRyb2wgZmxvd1xuICAgICAgICB3aGlsZSAoIWIpIHtcbiAgICAgICAgICAgIC8vIGVuZCBvZiBhIHN1YnN0YWNrOyBwb3AgdGhlIG93bmluZyBjb250cm9sIGZsb3cgYmxvY2sgZnJvbSBzdGFja1xuICAgICAgICAgICAgLy8gTm90ZTogVGhpcyBpcyBhIGxvb3AgdG8gaGFuZGxlIG5lc3RlZCBjb250cm9sIGZsb3cgYmxvY2tzLlxuXG4gICAgICAgICAgICAvLyB5aWVsZCBhdCB0aGUgZW5kIG9mIGEgbG9vcCBvciB3aGVuIHN0YWNrIGlzIGVtcHR5XG4gICAgICAgICAgICBpZiAodGhpcy5hY3RpdmVUaHJlYWQuc3RhY2subGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5hY3RpdmVUaHJlYWQubmV4dEJsb2NrID0gbnVsbDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGIgPSB0aGlzLmFjdGl2ZVRocmVhZC5zdGFjay5wb3AoKTtcbiAgICAgICAgICAgICAgICBpZiAoYi5pc0xvb3ApIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5hY3RpdmVUaHJlYWQubmV4dEJsb2NrID0gYjsgLy8gcHJlc2VydmUgd2hlcmUgaXQgbGVmdCBvZmZcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGIgPSBiLm5leHRCbG9jazsgLy8gc2tpcCBhbmQgY29udGludWUgZm9yIG5vbiBsb29waW5nIGJsb2Nrc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn07XG5cbkludGVycHJldGVyLnByb3RvdHlwZS50b2dnbGVUaHJlYWQgPSBmdW5jdGlvbihiLCB0YXJnZXRPYmopIHtcbiAgICB2YXIgbmV3VGhyZWFkcyA9IFtdLCB3YXNSdW5uaW5nID0gZmFsc2U7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnRocmVhZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKHRoaXMudGhyZWFkc1tpXS5zdGFja1swXSA9PSBiKSB7XG4gICAgICAgICAgICB3YXNSdW5uaW5nID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5ld1RocmVhZHMucHVzaCh0aGlzLnRocmVhZHNbaV0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIHRoaXMudGhyZWFkcyA9IG5ld1RocmVhZHM7XG4gICAgaWYgKCF3YXNSdW5uaW5nKSB7XG4gICAgICAgIHRoaXMuc3RhcnRUaHJlYWQoYiwgdGFyZ2V0T2JqKTtcbiAgICB9XG59XG5cbkludGVycHJldGVyLnByb3RvdHlwZS5zdGFydFRocmVhZCA9IGZ1bmN0aW9uKGIsIHRhcmdldE9iaikge1xuICAgIHRoaXMuYWN0aXZlVGhyZWFkID0gbmV3IFRocmVhZChiLCB0YXJnZXRPYmopO1xuICAgIHRoaXMudGhyZWFkcy5wdXNoKHRoaXMuYWN0aXZlVGhyZWFkKTtcbn07XG5cbkludGVycHJldGVyLnByb3RvdHlwZS5yZXN0YXJ0VGhyZWFkID0gZnVuY3Rpb24oYiwgdGFyZ2V0T2JqKSB7XG4gICAgLy8gdXNlZCBieSBicm9hZGNhc3Q7IHN0b3AgYW55IHRocmVhZCBydW5uaW5nIG9uIGIsIHRoZW4gc3RhcnQgYSBuZXcgdGhyZWFkIG9uIGJcbiAgICB2YXIgbmV3VGhyZWFkID0gbmV3IFRocmVhZChiLCB0YXJnZXRPYmopO1xuICAgIHZhciB3YXNSdW5uaW5nID0gZmFsc2U7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnRocmVhZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKHRoaXMudGhyZWFkc1tpXS5zdGFja1swXSA9PSBiKSB7XG4gICAgICAgICAgICB0aGlzLnRocmVhZHNbaV0gPSBuZXdUaHJlYWQ7XG4gICAgICAgICAgICB3YXNSdW5uaW5nID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBpZiAoIXdhc1J1bm5pbmcpIHtcbiAgICAgICAgdGhpcy50aHJlYWRzLnB1c2gobmV3VGhyZWFkKTtcbiAgICB9XG59O1xuXG5JbnRlcnByZXRlci5wcm90b3R5cGUuYXJnID0gZnVuY3Rpb24oYmxvY2ssIGluZGV4KSB7XG4gICAgdmFyIGFyZyA9IGJsb2NrLmFyZ3NbaW5kZXhdO1xuICAgIGlmICgodHlwZW9mKGFyZykgPT0gJ29iamVjdCcpICYmIChhcmcuY29uc3RydWN0b3IgPT0gQmxvY2spKSB7XG4gICAgICAgICsrdGhpcy5vcENvdW50O1xuICAgICAgICBpZiAodGhpcy5kZWJ1Z09wcyAmJiB0aGlzLmRlYnVnRnVuYykge1xuICAgICAgICAgICAgdmFyIGZpbmFsQXJncyA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmcuYXJncy5sZW5ndGg7ICsraSkge1xuICAgICAgICAgICAgICAgIGZpbmFsQXJncy5wdXNoKHRoaXMuYXJnKGFyZywgaSkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmRlYnVnRnVuYyh0aGlzLm9wQ291bnQyLCBhcmcub3AsIGZpbmFsQXJncyk7XG4gICAgICAgICAgICArK3RoaXMub3BDb3VudDI7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGFyZy5wcmltRmNuKGFyZyk7IC8vIGV4cHJlc3Npb25cbiAgICB9XG4gICAgcmV0dXJuIGFyZztcbn07XG5cbkludGVycHJldGVyLnByb3RvdHlwZS5udW1hcmcgPSBmdW5jdGlvbihibG9jaywgaW5kZXgpIHtcbiAgICB2YXIgYXJnID0gTnVtYmVyKHRoaXMuYXJnKGJsb2NrLCBpbmRleCkpO1xuICAgIGlmIChhcmcgIT09IGFyZykge1xuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG4gICAgcmV0dXJuIGFyZztcbn07XG5cbkludGVycHJldGVyLnByb3RvdHlwZS5ib29sYXJnID0gZnVuY3Rpb24oYmxvY2ssIGluZGV4KSB7XG4gICAgdmFyIGFyZyA9IHRoaXMuYXJnKGJsb2NrLCBpbmRleCk7XG4gICAgaWYgKHR5cGVvZiBhcmcgPT09ICdib29sZWFuJykge1xuICAgICAgICByZXR1cm4gYXJnO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGFyZyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuICEoYXJnID09PSAnJyB8fCBhcmcgPT09ICcwJyB8fCBhcmcudG9Mb3dlckNhc2UoKSA9PT0gJ2ZhbHNlJyk7XG4gICAgfVxuICAgIHJldHVybiBCb29sZWFuKGFyZyk7XG59O1xuXG5JbnRlcnByZXRlci5wcm90b3R5cGUudGFyZ2V0U3ByaXRlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuYWN0aXZlVGhyZWFkLnRhcmdldDtcbn07XG5cbkludGVycHJldGVyLnByb3RvdHlwZS50YXJnZXRTdGFnZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBydW50aW1lLnN0YWdlO1xufTtcblxuLy8gVGltZXJcbkludGVycHJldGVyLnByb3RvdHlwZS5zdGFydFRpbWVyID0gZnVuY3Rpb24oc2Vjcykge1xuICAgIHZhciB3YWl0TVNlY3MgPSAxMDAwICogc2VjcztcbiAgICBpZiAod2FpdE1TZWNzIDwgMCkgd2FpdE1TZWNzID0gMDtcbiAgICB0aGlzLmFjdGl2ZVRocmVhZC50bXAgPSB0aGlzLmN1cnJlbnRNU2VjcyArIHdhaXRNU2VjczsgLy8gZW5kIHRpbWUgaW4gbWlsbGlzZWNvbmRzXG4gICAgdGhpcy5hY3RpdmVUaHJlYWQuZmlyc3RUaW1lID0gZmFsc2U7XG4gICAgdGhpcy55aWVsZCA9IHRydWU7XG59O1xuXG5JbnRlcnByZXRlci5wcm90b3R5cGUuY2hlY2tUaW1lciA9IGZ1bmN0aW9uKCkge1xuICAgIC8vIGNoZWNrIGZvciB0aW1lciBleHBpcmF0aW9uIGFuZCBjbGVhbiB1cCBpZiBleHBpcmVkLiByZXR1cm4gdHJ1ZSB3aGVuIGV4cGlyZWRcbiAgICBpZiAodGhpcy5jdXJyZW50TVNlY3MgPj0gdGhpcy5hY3RpdmVUaHJlYWQudG1wKSB7XG4gICAgICAgIC8vIHRpbWUgZXhwaXJlZFxuICAgICAgICB0aGlzLmFjdGl2ZVRocmVhZC50bXAgPSAwO1xuICAgICAgICB0aGlzLmFjdGl2ZVRocmVhZC5maXJzdFRpbWUgPSB0cnVlO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnlpZWxkID0gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn07XG5cbkludGVycHJldGVyLnByb3RvdHlwZS5yZWRyYXcgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRvUmVkcmF3ID0gdHJ1ZTtcbn07XG5cbi8vIFByaW1pdGl2ZSBvcGVyYXRpb25zXG5JbnRlcnByZXRlci5wcm90b3R5cGUuaW5pdFByaW1zID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5wcmltaXRpdmVUYWJsZSA9IHt9O1xuICAgIHRoaXMucHJpbWl0aXZlVGFibGVbJ3doZW5HcmVlbkZsYWcnXSAgICAgICA9IHRoaXMucHJpbU5vb3A7XG4gICAgdGhpcy5wcmltaXRpdmVUYWJsZVsnd2hlbktleVByZXNzZWQnXSAgICAgID0gdGhpcy5wcmltTm9vcDtcbiAgICB0aGlzLnByaW1pdGl2ZVRhYmxlWyd3aGVuQ2xpY2tlZCddICAgICAgICAgPSB0aGlzLnByaW1Ob29wO1xuICAgIHRoaXMucHJpbWl0aXZlVGFibGVbJ2lmJ10gICAgICAgICAgICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgaWYgKGludGVycC5ib29sYXJnKGIsIDApKSBpbnRlcnAuc3RhcnRTdWJzdGFjayhiKTsgfTtcbiAgICB0aGlzLnByaW1pdGl2ZVRhYmxlWydkb0ZvcmV2ZXInXSAgICAgICAgICAgPSBmdW5jdGlvbihiKSB7IGludGVycC5zdGFydFN1YnN0YWNrKGIsIHRydWUpOyB9O1xuICAgIHRoaXMucHJpbWl0aXZlVGFibGVbJ2RvRm9yZXZlcklmJ10gICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgaWYgKGludGVycC5ib29sYXJnKGIsIDApKSBpbnRlcnAuc3RhcnRTdWJzdGFjayhiLCB0cnVlKTsgZWxzZSBpbnRlcnAueWllbGQgPSB0cnVlOyB9O1xuICAgIHRoaXMucHJpbWl0aXZlVGFibGVbJ2RvSWYnXSAgICAgICAgICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgaWYgKGludGVycC5ib29sYXJnKGIsIDApKSBpbnRlcnAuc3RhcnRTdWJzdGFjayhiKTsgfTtcbiAgICB0aGlzLnByaW1pdGl2ZVRhYmxlWydkb1JlcGVhdCddICAgICAgICAgICAgPSB0aGlzLnByaW1SZXBlYXQ7XG4gICAgdGhpcy5wcmltaXRpdmVUYWJsZVsnZG9JZkVsc2UnXSAgICAgICAgICAgID0gZnVuY3Rpb24oYikgeyBpZiAoaW50ZXJwLmJvb2xhcmcoYiwgMCkpIGludGVycC5zdGFydFN1YnN0YWNrKGIpOyBlbHNlIGludGVycC5zdGFydFN1YnN0YWNrKGIsIGZhbHNlLCB0cnVlKTsgfTtcbiAgICB0aGlzLnByaW1pdGl2ZVRhYmxlWydkb1dhaXRVbnRpbCddICAgICAgICAgPSBmdW5jdGlvbihiKSB7IGlmICghaW50ZXJwLmJvb2xhcmcoYiwgMCkpIGludGVycC55aWVsZCA9IHRydWU7IH07XG4gICAgdGhpcy5wcmltaXRpdmVUYWJsZVsnZG9VbnRpbCddICAgICAgICAgICAgID0gZnVuY3Rpb24oYikgeyBpZiAoIWludGVycC5ib29sYXJnKGIsIDApKSBpbnRlcnAuc3RhcnRTdWJzdGFjayhiLCB0cnVlKTsgfTtcbiAgICB0aGlzLnByaW1pdGl2ZVRhYmxlWydkb1JldHVybiddICAgICAgICAgICAgPSBmdW5jdGlvbihiKSB7IGludGVycC5hY3RpdmVUaHJlYWQgPSBuZXcgVGhyZWFkKG51bGwpOyB9O1xuICAgIHRoaXMucHJpbWl0aXZlVGFibGVbJ3N0b3BBbGwnXSAgICAgICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgaW50ZXJwLmFjdGl2ZVRocmVhZCA9IG5ldyBUaHJlYWQobnVsbCk7IGludGVycC50aHJlYWRzID0gW107IH1cbiAgICB0aGlzLnByaW1pdGl2ZVRhYmxlWyd3aGVuSVJlY2VpdmUnXSAgICAgICAgPSB0aGlzLnByaW1Ob29wO1xuICAgIHRoaXMucHJpbWl0aXZlVGFibGVbJ2Jyb2FkY2FzdDonXSAgICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgaW50ZXJwLmJyb2FkY2FzdChiLCBmYWxzZSk7IH07XG4gICAgdGhpcy5wcmltaXRpdmVUYWJsZVsnZG9Ccm9hZGNhc3RBbmRXYWl0J10gID0gZnVuY3Rpb24oYikgeyBpbnRlcnAuYnJvYWRjYXN0KGIsIHRydWUpOyB9O1xuICAgIHRoaXMucHJpbWl0aXZlVGFibGVbJ3dhaXQ6ZWxhcHNlZDpmcm9tOiddICA9IHRoaXMucHJpbVdhaXQ7XG5cbiAgICAvLyBhZGRlZCBieSBKb2huOlxuICAgIHRoaXMucHJpbWl0aXZlVGFibGVbJ3Nob3dCdWJibGUnXSA9IGZ1bmN0aW9uKGIpIHsgY29uc29sZS5sb2coaW50ZXJwLmFyZyhiLCAxKSk7IH07XG4gICAgdGhpcy5wcmltaXRpdmVUYWJsZVsndGltZXJSZXNldCddID0gZnVuY3Rpb24oYikgeyBpbnRlcnAudGltZXJCYXNlID0gRGF0ZS5ub3coKTsgfTtcbiAgICB0aGlzLnByaW1pdGl2ZVRhYmxlWyd0aW1lciddID0gZnVuY3Rpb24oYikgeyByZXR1cm4gKERhdGUubm93KCkgLSBpbnRlcnAudGltZXJCYXNlKSAvIDEwMDA7IH07XG5cbiAgICBuZXcgUHJpbWl0aXZlcygpLmFkZFByaW1zVG8odGhpcy5wcmltaXRpdmVUYWJsZSk7XG59O1xuXG5JbnRlcnByZXRlci5wcm90b3R5cGUudGltZXJCYXNlID0gRGF0ZS5ub3coKTtcbkludGVycHJldGVyLnByb3RvdHlwZS5sb29rdXBQcmltID0gZnVuY3Rpb24ob3ApIHtcbiAgICB2YXIgZmNuID0gaW50ZXJwLnByaW1pdGl2ZVRhYmxlW29wXTtcbiAgICBpZiAoZmNuID09IG51bGwpIGZjbiA9IGZ1bmN0aW9uKGIpIHsgY29uc29sZS5sb2coJ25vdCBpbXBsZW1lbnRlZDogJyArIGIub3ApOyB9O1xuICAgIHJldHVybiBmY247XG59O1xuXG5JbnRlcnByZXRlci5wcm90b3R5cGUucHJpbU5vb3AgPSBmdW5jdGlvbihiKSB7IGNvbnNvbGUubG9nKGIub3ApOyB9O1xuXG5JbnRlcnByZXRlci5wcm90b3R5cGUucHJpbVdhaXQgPSBmdW5jdGlvbihiKSB7XG4gICAgaWYgKGludGVycC5hY3RpdmVUaHJlYWQuZmlyc3RUaW1lKSB7XG4gICAgICAgIGludGVycC5zdGFydFRpbWVyKGludGVycC5udW1hcmcoYiwgMCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGludGVycC5jaGVja1RpbWVyKCk7XG4gICAgfVxufTtcblxuSW50ZXJwcmV0ZXIucHJvdG90eXBlLnByaW1SZXBlYXQgPSBmdW5jdGlvbihiKSB7XG4gICAgaWYgKGIudG1wID09IC0xKSB7XG4gICAgICAgIGIudG1wID0gTWF0aC5tYXgoaW50ZXJwLm51bWFyZyhiLCAwKSwgMCk7IC8vIEluaXRpYWxpemUgcmVwZWF0IGNvdW50IG9uIHRoaXMgYmxvY2tcbiAgICB9XG4gICAgaWYgKGIudG1wID4gMCkge1xuICAgICAgICBiLnRtcCAtPSAxOyAvLyBkZWNyZW1lbnQgY291bnRcbiAgICAgICAgaW50ZXJwLnN0YXJ0U3Vic3RhY2soYiwgdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRG9uZSBleGVjdXRpbmcgdGhpcyByZXBlYXQgYmxvY2sgZm9yIHRoaXMgcm91bmRcbiAgICAgICAgYi50bXAgPSAtMTtcbiAgICAgICAgYiA9IG51bGw7XG4gICAgfVxufTtcblxuSW50ZXJwcmV0ZXIucHJvdG90eXBlLmJyb2FkY2FzdCA9IGZ1bmN0aW9uKGIsIHdhaXRGbGFnKSB7XG4gICAgdmFyIHBhaXI7XG4gICAgaWYgKGludGVycC5hY3RpdmVUaHJlYWQuZmlyc3RUaW1lKSB7XG4gICAgICAgIHZhciByZWNlaXZlcnMgPSBbXTtcbiAgICAgICAgdmFyIG1zZyA9IFN0cmluZyhpbnRlcnAuYXJnKGIsIDApKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICB2YXIgZmluZFJlY2VpdmVycyA9IGZ1bmN0aW9uKHN0YWNrLCB0YXJnZXQpIHtcbiAgICAgICAgICAgIGlmICgoc3RhY2sub3AgPT0gJ3doZW5JUmVjZWl2ZScpICYmIChzdGFjay5hcmdzWzBdLnRvTG93ZXJDYXNlKCkgPT0gbXNnKSkge1xuICAgICAgICAgICAgICAgIHJlY2VpdmVycy5wdXNoKFtzdGFjaywgdGFyZ2V0XSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcnVudGltZS5hbGxTdGFja3NEbyhmaW5kUmVjZWl2ZXJzKTtcbiAgICAgICAgZm9yIChwYWlyIGluIHJlY2VpdmVycykge1xuICAgICAgICAgICAgaW50ZXJwLnJlc3RhcnRUaHJlYWQocmVjZWl2ZXJzW3BhaXJdWzBdLCByZWNlaXZlcnNbcGFpcl1bMV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmICghd2FpdEZsYWcpIHJldHVybjtcbiAgICAgICAgaW50ZXJwLmFjdGl2ZVRocmVhZC50bXBPYmogPSByZWNlaXZlcnM7XG4gICAgICAgIGludGVycC5hY3RpdmVUaHJlYWQuZmlyc3RUaW1lID0gZmFsc2U7XG4gICAgfVxuICAgIHZhciBkb25lID0gdHJ1ZTtcbiAgICBmb3IgKHBhaXIgaW4gaW50ZXJwLmFjdGl2ZVRocmVhZC50bXBPYmopIHtcbiAgICAgICAgaWYgKGludGVycC5pc1J1bm5pbmcoaW50ZXJwLmFjdGl2ZVRocmVhZC50bXBPYmpbcGFpcl1bMF0pKSB7XG4gICAgICAgICAgICBkb25lID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGRvbmUpIHtcbiAgICAgICAgaW50ZXJwLmFjdGl2ZVRocmVhZC50bXBPYmogPSBudWxsO1xuICAgICAgICBpbnRlcnAuYWN0aXZlVGhyZWFkLmZpcnN0VGltZSA9IHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgaW50ZXJwLnlpZWxkID0gdHJ1ZTtcbiAgICB9XG59O1xuXG5JbnRlcnByZXRlci5wcm90b3R5cGUuaXNSdW5uaW5nID0gZnVuY3Rpb24oYikge1xuICAgIGZvciAodmFyIHQgaW4gaW50ZXJwLnRocmVhZHMpIHtcbiAgICAgICAgaWYgKGludGVycC50aHJlYWRzW3RdLmZpcnN0QmxvY2sgPT0gYikge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xufTtcblxuSW50ZXJwcmV0ZXIucHJvdG90eXBlLnN0YXJ0U3Vic3RhY2sgPSBmdW5jdGlvbihiLCBpc0xvb3AsIHNlY29uZFN1YnN0YWNrKSB7XG4gICAgLy8gU3RhcnQgdGhlIHN1YnN0YWNrIG9mIGEgY29udHJvbCBzdHJ1Y3R1cmUgY29tbWFuZCBzdWNoIGFzIGlmIG9yIGZvcmV2ZXIuXG4gICAgYi5pc0xvb3AgPSAhIWlzTG9vcDtcbiAgICB0aGlzLmFjdGl2ZVRocmVhZC5zdGFjay5wdXNoKGIpOyAvLyByZW1lbWJlciB0aGUgYmxvY2sgdGhhdCBzdGFydGVkIHRoZSBzdWJzdGFja1xuICAgIGlmICghc2Vjb25kU3Vic3RhY2spIHtcbiAgICAgICAgdGhpcy5hY3RpdmVUaHJlYWQubmV4dEJsb2NrID0gYi5zdWJzdGFjaztcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmFjdGl2ZVRocmVhZC5uZXh0QmxvY2sgPSBiLnN1YnN0YWNrMjtcbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEludGVycHJldGVyO1xubW9kdWxlLmV4cG9ydHMuVGhyZWFkID0gVGhyZWFkO1xubW9kdWxlLmV4cG9ydHMuQmxvY2sgPSBCbG9jaztcbiIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuLy8gU2NyYXRjaCBIVE1MNSBQbGF5ZXJcbi8vIFJ1bnRpbWUuanNcbi8vIFRpbSBNaWNrZWwsIEp1bHkgMjAxMVxuXG4vLyBSdW50aW1lIHRha2VzIGNhcmUgb2YgdGhlIHJlbmRlcmluZyBhbmQgc3RlcHBpbmcgbG9naWMuXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIFRocmVhZCA9IHJlcXVpcmUoJy4vSW50ZXJwcmV0ZXInKS5UaHJlYWQsXG4gICAgU291bmRQcmltcyA9IHJlcXVpcmUoJy4vcHJpbWl0aXZlcy9Tb3VuZFByaW1zJyksXG4gICAgSW5zdHIgPSByZXF1aXJlKCcuLi9zb3VuZGJhbmsvSW5zdHInKSxcbiAgICBTcHJpdGUgPSByZXF1aXJlKCcuL1Nwcml0ZScpLFxuICAgIFRpbWVyID0gcmVxdWlyZSgnLi91dGlsL1RpbWVyJyk7XG5cbnZhciB0ID0gbmV3IFRpbWVyKCk7XG5cbnZhciBSdW50aW1lID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zY2VuZSA9IG51bGw7XG4gICAgdGhpcy5zcHJpdGVzID0gW107XG4gICAgdGhpcy5yZXBvcnRlcnMgPSBbXTtcbiAgICB0aGlzLmtleXNEb3duID0ge307XG4gICAgdGhpcy5tb3VzZURvd24gPSBmYWxzZTtcbiAgICB0aGlzLm1vdXNlUG9zID0gWzAsIDBdO1xuICAgIHRoaXMuYXVkaW9Db250ZXh0ID0gbnVsbDtcbiAgICB0aGlzLmF1ZGlvR2FpbiA9IG51bGw7XG4gICAgdGhpcy5hdWRpb1BsYXlpbmcgPSBbXTtcbiAgICB0aGlzLm5vdGVzUGxheWluZyA9IFtdO1xuICAgIHRoaXMucHJvamVjdExvYWRlZCA9IGZhbHNlO1xufTtcblxuLy8gSW5pdGlhbGl6ZXIgZm9yIHRoZSBkcmF3aW5nIGFuZCBhdWRpbyBjb250ZXh0cy5cblJ1bnRpbWUucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNjZW5lID0gJCgnI2NvbnRhaW5lcicpO1xuICAgIHdpbmRvdy5BdWRpb0NvbnRleHQgPSB3aW5kb3cuQXVkaW9Db250ZXh0IHx8IHdpbmRvdy53ZWJraXRBdWRpb0NvbnRleHQ7XG4gICAgdGhpcy5hdWRpb0NvbnRleHQgPSBuZXcgQXVkaW9Db250ZXh0KCk7XG4gICAgdHJ5IHtcbiAgICAgICAgdGhpcy5hdWRpb0dhaW4gPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVHYWluKCk7XG4gICAgfSBjYXRjaChlcnIpIHtcbiAgICAgICAgdGhpcy5hdWRpb0dhaW4gPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVHYWluTm9kZSgpO1xuICAgIH1cbiAgICB0aGlzLmF1ZGlvR2Fpbi5jb25uZWN0KHJ1bnRpbWUuYXVkaW9Db250ZXh0LmRlc3RpbmF0aW9uKTtcbn07XG5cbi8vIExvYWQgc3RhcnQgd2FpdHMgZm9yIHRoZSBzdGFnZSBhbmQgdGhlIHNwcml0ZXMgdG8gYmUgbG9hZGVkLCB3aXRob3V0XG4vLyBoYW5naW5nIHRoZSBicm93c2VyLiAgV2hlbiB0aGUgbG9hZGluZyBpcyBmaW5pc2hlZCwgd2UgYmVnaW4gdGhlIHN0ZXBcbi8vIGFuZCBhbmltYXRlIG1ldGhvZHMuXG5SdW50aW1lLnByb3RvdHlwZS5sb2FkU3RhcnQgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXJ1bnRpbWUuc3RhZ2UuaXNMb2FkZWQoKSkge1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKHJ1bnRpbWUpIHsgcnVudGltZS5sb2FkU3RhcnQoKTsgfSwgNTAsIHRoaXMpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAodmFyIG9iaiA9IDA7IG9iaiA8IHJ1bnRpbWUuc3ByaXRlcy5sZW5ndGg7IG9iaisrKSB7XG4gICAgICAgIGlmICh0eXBlb2YocnVudGltZS5zcHJpdGVzW29ial0pID09ICdvYmplY3QnICYmIHJ1bnRpbWUuc3ByaXRlc1tvYmpdLmNvbnN0cnVjdG9yID09IFNwcml0ZSkge1xuICAgICAgICAgICAgaWYgKCFydW50aW1lLnNwcml0ZXNbb2JqXS5pc0xvYWRlZCgpKSB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbihydW50aW1lKSB7IHJ1bnRpbWUubG9hZFN0YXJ0KCk7IH0sIDUwLCB0aGlzKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKEluc3RyLndhdnNMb2FkZWQgIT0gSW5zdHIud2F2Q291bnQpIHtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbihydW50aW1lKSB7IHJ1bnRpbWUubG9hZFN0YXJ0KCk7IH0sIDUwLCB0aGlzKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAkKCcjcHJlbG9hZGVyJykuY3NzKCdkaXNwbGF5JywgJ25vbmUnKTtcbiAgICBzZXRJbnRlcnZhbCh0aGlzLnN0ZXAsIDMzKTtcbiAgICB0aGlzLnByb2plY3RMb2FkZWQgPSB0cnVlO1xufTtcblxuUnVudGltZS5wcm90b3R5cGUuZ3JlZW5GbGFnID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMucHJvamVjdExvYWRlZCkge1xuICAgICAgICBpbnRlcnAuYWN0aXZlVGhyZWFkID0gbmV3IFRocmVhZChudWxsKTtcbiAgICAgICAgaW50ZXJwLnRocmVhZHMgPSBbXTtcbiAgICAgICAgaW50ZXJwLnByaW1pdGl2ZVRhYmxlLnRpbWVyUmVzZXQoKTtcbiAgICAgICAgdGhpcy5zdGFydEdyZWVuRmxhZ3MoKTtcbiAgICB9XG59O1xuXG5SdW50aW1lLnByb3RvdHlwZS5zdG9wQWxsID0gZnVuY3Rpb24oKSB7XG4gICAgaW50ZXJwLmFjdGl2ZVRocmVhZCA9IG5ldyBUaHJlYWQobnVsbCk7XG4gICAgaW50ZXJwLnRocmVhZHMgPSBbXTtcbiAgICBTb3VuZFByaW1zLnN0b3BBbGxTb3VuZHMoKTtcbiAgICAvLyBIaWRlIHNwcml0ZSBidWJibGVzLCByZXNldEZpbHRlcnMgYW5kIGRvQXNrIHByb21wdHNcbiAgICBmb3IgKHZhciBzID0gMDsgcyA8IHJ1bnRpbWUuc3ByaXRlcy5sZW5ndGg7IHMrKykge1xuICAgICAgICBpZiAocnVudGltZS5zcHJpdGVzW3NdLmhpZGVCdWJibGUpIHJ1bnRpbWUuc3ByaXRlc1tzXS5oaWRlQnViYmxlKCk7XG4gICAgICAgIGlmIChydW50aW1lLnNwcml0ZXNbc10ucmVzZXRGaWx0ZXJzKSBydW50aW1lLnNwcml0ZXNbc10ucmVzZXRGaWx0ZXJzKCk7XG4gICAgICAgIGlmIChydW50aW1lLnNwcml0ZXNbc10uaGlkZUFzaykgcnVudGltZS5zcHJpdGVzW3NdLmhpZGVBc2soKTtcbiAgICB9XG4gICAgLy8gUmVzZXQgZ3JhcGhpYyBlZmZlY3RzXG4gICAgcnVudGltZS5zdGFnZS5yZXNldEZpbHRlcnMoKTtcbn07XG5cbi8vIFN0ZXAgbWV0aG9kIGZvciBleGVjdXRpb24gLSBjYWxsZWQgZXZlcnkgMzMgbWlsbGlzZWNvbmRzXG5SdW50aW1lLnByb3RvdHlwZS5zdGVwID0gZnVuY3Rpb24oKSB7XG4gICAgaW50ZXJwLnN0ZXBUaHJlYWRzKCk7XG4gICAgZm9yICh2YXIgciA9IDA7IHIgPCBydW50aW1lLnJlcG9ydGVycy5sZW5ndGg7IHIrKykge1xuICAgICAgICBydW50aW1lLnJlcG9ydGVyc1tyXS51cGRhdGUoKTtcbiAgICB9XG59O1xuXG4vLyBTdGFjayBmdW5jdGlvbnMgLS0gcHVzaCBhbmQgcmVtb3ZlIHN0YWNrc1xuLy8gdG8gYmUgcnVuIGJ5IHRoZSBpbnRlcnByZXRlciBhcyB0aHJlYWRzLlxuUnVudGltZS5wcm90b3R5cGUuYWxsU3RhY2tzRG8gPSBmdW5jdGlvbihmKSB7XG4gICAgdmFyIHN0YWdlID0gcnVudGltZS5zdGFnZTtcbiAgICB2YXIgc3RhY2s7XG4gICAgZm9yICh2YXIgaSA9IHJ1bnRpbWUuc3ByaXRlcy5sZW5ndGgtMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgdmFyIG8gPSBydW50aW1lLnNwcml0ZXNbaV07XG4gICAgICAgIGlmICh0eXBlb2YobykgPT0gJ29iamVjdCcgJiYgby5jb25zdHJ1Y3RvciA9PSBTcHJpdGUpIHtcbiAgICAgICAgICAgICQuZWFjaChvLnN0YWNrcywgZnVuY3Rpb24oaW5kZXgsIHN0YWNrKSB7XG4gICAgICAgICAgICAgICAgZihzdGFjaywgbyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAkLmVhY2goc3RhZ2Uuc3RhY2tzLCBmdW5jdGlvbihpbmRleCwgc3RhY2spIHtcbiAgICAgICAgZihzdGFjaywgc3RhZ2UpO1xuICAgIH0pO1xufTtcblxuLy8gSGF0IHRyaWdnZXJzXG5SdW50aW1lLnByb3RvdHlwZS5zdGFydEdyZWVuRmxhZ3MgPSBmdW5jdGlvbigpIHtcbiAgICBmdW5jdGlvbiBzdGFydElmR3JlZW5GbGFnKHN0YWNrLCB0YXJnZXQpIHtcbiAgICAgICAgaWYgKHN0YWNrLm9wID09ICd3aGVuR3JlZW5GbGFnJykgaW50ZXJwLnRvZ2dsZVRocmVhZChzdGFjaywgdGFyZ2V0KTtcbiAgICB9XG4gICAgdGhpcy5hbGxTdGFja3NEbyhzdGFydElmR3JlZW5GbGFnKTtcbn07XG5cblJ1bnRpbWUucHJvdG90eXBlLnN0YXJ0S2V5SGF0cyA9IGZ1bmN0aW9uKGNoKSB7XG4gICAgdmFyIGtleU5hbWUgPSBudWxsO1xuICAgIGlmICgoJ0EnLmNoYXJDb2RlQXQoMCkgPD0gY2gpICYmIChjaCA8PSAnWicuY2hhckNvZGVBdCgwKSkgfHxcbiAgICAgICAgKCdhJy5jaGFyQ29kZUF0KDApIDw9IGNoKSAmJiAoY2ggPD0gJ3onLmNoYXJDb2RlQXQoMCkpKVxuICAgICAgICBrZXlOYW1lID0gU3RyaW5nLmZyb21DaGFyQ29kZShjaCkudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAoKCcwJy5jaGFyQ29kZUF0KDApIDw9IGNoKSAmJiAoY2ggPD0gJzknLmNoYXJDb2RlQXQoMCkpKVxuICAgICAgICBrZXlOYW1lID0gU3RyaW5nLmZyb21DaGFyQ29kZShjaCk7XG5cbiAgICBpZiAoY2ggPT0gMzcpIGtleU5hbWUgPSBcImxlZnQgYXJyb3dcIjtcbiAgICBpZiAoY2ggPT0gMzkpIGtleU5hbWUgPSBcInJpZ2h0IGFycm93XCI7XG4gICAgaWYgKGNoID09IDM4KSBrZXlOYW1lID0gXCJ1cCBhcnJvd1wiO1xuICAgIGlmIChjaCA9PSA0MCkga2V5TmFtZSA9IFwiZG93biBhcnJvd1wiO1xuICAgIGlmIChjaCA9PSAzMikga2V5TmFtZSA9IFwic3BhY2VcIjtcblxuICAgIGlmIChrZXlOYW1lID09IG51bGwpIHJldHVybjtcbiAgICB2YXIgc3RhcnRNYXRjaGluZ0tleUhhdHMgPSBmdW5jdGlvbihzdGFjaywgdGFyZ2V0KSB7XG4gICAgICAgIGlmICgoc3RhY2sub3AgPT0gXCJ3aGVuS2V5UHJlc3NlZFwiKSAmJiAoc3RhY2suYXJnc1swXSA9PSBrZXlOYW1lKSkge1xuICAgICAgICAgICAgLy8gT25seSBzdGFydCB0aGUgc3RhY2sgaWYgaXQgaXMgbm90IGFscmVhZHkgcnVubmluZ1xuICAgICAgICAgICAgaWYgKCFpbnRlcnAuaXNSdW5uaW5nKHN0YWNrKSkge1xuICAgICAgICAgICAgICAgIGludGVycC50b2dnbGVUaHJlYWQoc3RhY2ssIHRhcmdldCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgcnVudGltZS5hbGxTdGFja3NEbyhzdGFydE1hdGNoaW5nS2V5SGF0cyk7XG59O1xuXG5SdW50aW1lLnByb3RvdHlwZS5zdGFydENsaWNrZWRIYXRzID0gZnVuY3Rpb24oc3ByaXRlKSB7XG4gICAgZnVuY3Rpb24gc3RhcnRJZkNsaWNrZWQoc3RhY2ssIHRhcmdldCkge1xuICAgICAgICBpZiAodGFyZ2V0ID09IHNwcml0ZSAmJiBzdGFjay5vcCA9PSBcIndoZW5DbGlja2VkXCIgJiYgIWludGVycC5pc1J1bm5pbmcoc3RhY2spKSB7XG4gICAgICAgICAgICBpbnRlcnAudG9nZ2xlVGhyZWFkKHN0YWNrLCB0YXJnZXQpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJ1bnRpbWUuYWxsU3RhY2tzRG8oc3RhcnRJZkNsaWNrZWQpO1xufTtcblxuLy8gUmV0dXJucyB0cnVlIGlmIGEga2V5IGlzIHByZXNzZWQuXG5SdW50aW1lLnByb3RvdHlwZS5rZXlJc0Rvd24gPSBmdW5jdGlvbihjaCkge1xuICAgIHJldHVybiB0aGlzLmtleXNEb3duW2NoXSB8fCBmYWxzZTtcbn07XG5cbi8vIFNwcml0ZSBuYW1lZCAtLSByZXR1cm5zIG9uZSBvZiB0aGUgc3ByaXRlcyBvbiB0aGUgc3RhZ2UuXG5SdW50aW1lLnByb3RvdHlwZS5zcHJpdGVOYW1lZCA9IGZ1bmN0aW9uKG4pIHtcbiAgICBpZiAobiA9PSAnU3RhZ2UnKSByZXR1cm4gdGhpcy5zdGFnZTtcbiAgICB2YXIgc2VsZWN0ZWRfc3ByaXRlID0gbnVsbDtcbiAgICAkLmVhY2godGhpcy5zcHJpdGVzLCBmdW5jdGlvbihpbmRleCwgcykge1xuICAgICAgICBpZiAocy5vYmpOYW1lID09IG4pIHtcbiAgICAgICAgICAgIHNlbGVjdGVkX3Nwcml0ZSA9IHM7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gc2VsZWN0ZWRfc3ByaXRlO1xufTtcblxuUnVudGltZS5wcm90b3R5cGUuZ2V0VGltZVN0cmluZyA9IGZ1bmN0aW9uKHdoaWNoKSB7XG4gICAgLy8gUmV0dXJuIGxvY2FsIHRpbWUgcHJvcGVydGllcy5cbiAgICB2YXIgbm93ID0gbmV3IERhdGUoKTtcbiAgICBzd2l0Y2ggKHdoaWNoKSB7XG4gICAgICAgIGNhc2UgJ2hvdXInOiByZXR1cm4gbm93LmdldEhvdXJzKCk7XG4gICAgICAgIGNhc2UgJ21pbnV0ZSc6IHJldHVybiBub3cuZ2V0TWludXRlcygpO1xuICAgICAgICBjYXNlICdzZWNvbmQnOiByZXR1cm4gbm93LmdldFNlY29uZHMoKTtcbiAgICAgICAgY2FzZSAneWVhcic6IHJldHVybiBub3cuZ2V0RnVsbFllYXIoKTsgLy8gZm91ciBkaWdpdCB5ZWFyIChlLmcuIDIwMTIpXG4gICAgICAgIGNhc2UgJ21vbnRoJzogcmV0dXJuIG5vdy5nZXRNb250aCgpICsgMTsgLy8gMS0xMlxuICAgICAgICBjYXNlICdkYXRlJzogcmV0dXJuIG5vdy5nZXREYXRlKCk7IC8vIDEtMzFcbiAgICAgICAgY2FzZSAnZGF5IG9mIHdlZWsnOiByZXR1cm4gbm93LmdldERheSgpICsgMTsgLy8gMS03LCB3aGVyZSAxIGlzIFN1bmRheVxuICAgIH1cbiAgICByZXR1cm4gJyc7IC8vIHNob3VsZG4ndCBoYXBwZW5cbn07XG5cbi8vIFJlYXNzaWducyB6LWluZGljZXMgZm9yIGxheWVyIGZ1bmN0aW9uc1xuUnVudGltZS5wcm90b3R5cGUucmVhc3NpZ25aID0gZnVuY3Rpb24odGFyZ2V0LCBtb3ZlKSB7XG4gICAgdmFyIHNwcml0ZXMgPSB0aGlzLnNwcml0ZXM7XG4gICAgdmFyIG9sZEluZGV4ID0gLTE7XG4gICAgJC5lYWNoKHRoaXMuc3ByaXRlcywgZnVuY3Rpb24oaW5kZXgsIHNwcml0ZSkge1xuICAgICAgICBpZiAoc3ByaXRlID09IHRhcmdldCkge1xuICAgICAgICAgICAgLy8gU3BsaWNlIG91dCB0aGUgc3ByaXRlIGZyb20gaXRzIG9sZCBwb3NpdGlvblxuICAgICAgICAgICAgb2xkSW5kZXggPSBpbmRleDtcbiAgICAgICAgICAgIHNwcml0ZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKG1vdmUgPT0gbnVsbCkge1xuICAgICAgICAvLyBNb3ZlIHRvIHRoZSBmcm9udFxuICAgICAgICB0aGlzLnNwcml0ZXMuc3BsaWNlKHRoaXMuc3ByaXRlcy5sZW5ndGgsIDAsIHRhcmdldCk7XG4gICAgfSBlbHNlIGlmIChvbGRJbmRleCAtIG1vdmUgPj0gMCAmJiBvbGRJbmRleCAtIG1vdmUgPCB0aGlzLnNwcml0ZXMubGVuZ3RoICsgMSkge1xuICAgICAgICAvLyBNb3ZlIHRvIHRoZSBuZXcgcG9zaXRpb25cbiAgICAgICAgdGhpcy5zcHJpdGVzLnNwbGljZShvbGRJbmRleCAtIG1vdmUsIDAsIHRhcmdldCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gTm8gY2hhbmdlIGlzIHJlcXVpcmVkXG4gICAgICAgIHRoaXMuc3ByaXRlcy5zcGxpY2Uob2xkSW5kZXgsIDAsIHRhcmdldCk7XG4gICAgfVxuXG4gICAgLy8gUmVudW1iZXIgdGhlIHotaW5kaWNlc1xuICAgIHZhciBuZXdaID0gMTtcbiAgICAkLmVhY2godGhpcy5zcHJpdGVzLCBmdW5jdGlvbihpbmRleCwgc3ByaXRlKSB7XG4gICAgICAgIHNwcml0ZS56ID0gbmV3WjtcbiAgICAgICAgc3ByaXRlLnVwZGF0ZUxheWVyKCk7XG4gICAgICAgIG5ld1orKztcbiAgICB9KTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gUnVudGltZTtcbiIsIihmdW5jdGlvbiAoZ2xvYmFsKXtcbi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuLy8gU2NyYXRjaCBIVE1MNSBQbGF5ZXJcbi8vIFNjcmF0Y2guanNcbi8vIFRpbSBNaWNrZWwsIEp1bHkgMjAxMVxuXG4vLyBIZXJlIHdlIGRlZmluZSB0aGUgYWN0aW9ucyB0YWtlbiBvbiB3aW5kb3cgbG9hZC5cbi8vIFRoZSB0aHJlZSBhcHBsaWNhdGlvbi13aWRlIGdsb2JhbCB2YXJpYWJsZXMgYXJlIGRlZmluZWQgaGVyZS5cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgSW50ZXJwcmV0ZXIgPSByZXF1aXJlKCcuL0ludGVycHJldGVyJyksXG4gICAgUnVudGltZSA9IHJlcXVpcmUoJy4vUnVudGltZScpLFxuICAgIElPID0gcmVxdWlyZSgnLi9JTycpO1xuXG52YXIgaW9zQXVkaW9BY3RpdmUgPSBmYWxzZTtcbmZ1bmN0aW9uIFNjcmF0Y2gocHJvamVjdF9pZCkge1xuICAgIGdsb2JhbC5ydW50aW1lID0gbmV3IFJ1bnRpbWUoKTtcbiAgICBydW50aW1lLmluaXQoKTtcblxuICAgICQod2luZG93KS5rZXlkb3duKGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgcnVudGltZS5rZXlzRG93bltlLndoaWNoXSA9IHRydWU7XG4gICAgICAgIHJ1bnRpbWUuc3RhcnRLZXlIYXRzKGUud2hpY2gpO1xuICAgIH0pO1xuXG4gICAgJCh3aW5kb3cpLmtleXVwKGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgZGVsZXRlIHJ1bnRpbWUua2V5c0Rvd25bZS53aGljaF07XG4gICAgfSk7XG5cbiAgICB2YXIgYWRkcmVzcyA9ICQoJyNhZGRyZXNzLWhpbnQnKTtcbiAgICB2YXIgcHJvamVjdCA9ICQoJyNwcm9qZWN0LWlkJyk7XG5cbiAgICAvLyBVcGRhdGUgdGhlIHByb2plY3QgSUQgZmllbGRcbiAgICBwcm9qZWN0LnZhbChwcm9qZWN0X2lkKTtcblxuICAgIC8vIFZhbGlkYXRlIHByb2plY3QgSUQgZmllbGRcbiAgICBwcm9qZWN0LmtleXVwKGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgbiA9IHRoaXMudmFsdWU7XG5cbiAgICAgICAgLy8gQWxsb3cgVVJMIHBhc3RpbmdcbiAgICAgICAgdmFyIGUgPSAvcHJvamVjdHNcXC8oXFxkKykvLmV4ZWMobik7XG4gICAgICAgIGlmIChlKSB7XG4gICAgICAgICAgICBuID0gdGhpcy52YWx1ZSA9IGVbMV07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBFdmVudHVhbGx5LCB0aGlzIHdpbGwgeGhyIHRvIC9wcm9qZWN0cy97e3RoaXMudmFsdWV9fS8gYW5kXG4gICAgICAgIC8vIGNoYW5nZSBjb2xvciBiYXNlZCBvbiB3aGV0aGVyIHRoZSByZXNwb25zZSBpcyA0MDQgb3IgMjAwLlxuICAgICAgICAkKCcjcHJvamVjdC1pZCwgI2FkZHJlc3MtaGludCcpLnRvZ2dsZUNsYXNzKCdlcnJvcicsIGlzTmFOKG4pKTtcbiAgICB9KTtcblxuICAgIC8vIEZvY3VzIHRoZSBhY3R1YWwgaW5wdXQgd2hlbiB0aGUgdXNlciBjbGlja3Mgb24gdGhlIFVSTCBoaW50XG4gICAgYWRkcmVzcy5jbGljayhmdW5jdGlvbigpIHtcbiAgICAgICAgcHJvamVjdC5zZWxlY3QoKTtcbiAgICB9KTtcblxuICAgIHZhciB3aWR0aCA9IGFkZHJlc3Mub3V0ZXJXaWR0aCgpO1xuICAgIHByb2plY3QuY3NzKHtcbiAgICAgICAgcGFkZGluZ0xlZnQ6IHdpZHRoLFxuICAgICAgICBtYXJnaW5MZWZ0OiAtd2lkdGhcbiAgICB9KTtcblxuICAgIC8vIEdvIHByb2plY3QgYnV0dG9uIGJlaGF2aW9yXG4gICAgJCgnI2dvLXByb2plY3QnKS5jbGljayhmdW5jdGlvbigpIHtcbiAgICAgICAgd2luZG93LmxvY2F0aW9uID0gJyMnICsgcGFyc2VJbnQoJCgnI3Byb2plY3QtaWQnKS52YWwoKSk7XG4gICAgICAgIHdpbmRvdy5sb2NhdGlvbi5yZWxvYWQodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICAvLyBHcmVlbiBmbGFnIGJlaGF2aW9yXG4gICAgJCgnI3RyaWdnZXItZ3JlZW4tZmxhZywgI292ZXJsYXknKS5jbGljayhmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKCFydW50aW1lLnByb2plY3RMb2FkZWQpIHJldHVybjtcbiAgICAgICAgJCgnI292ZXJsYXknKS5jc3MoJ2Rpc3BsYXknLCAnbm9uZScpO1xuICAgICAgICBydW50aW1lLmdyZWVuRmxhZygpXG4gICAgfSk7XG5cbiAgICAvLyBTdG9wIGJ1dHRvbiBiZWhhdmlvclxuICAgICQoJyN0cmlnZ2VyLXN0b3AnKS5jbGljayhmdW5jdGlvbigpIHtcbiAgICAgICAgcnVudGltZS5zdG9wQWxsKCk7XG4gICAgfSk7XG5cbiAgICAvLyBDYW52YXMgY29udGFpbmVyIG1vdXNlIGV2ZW50c1xuICAgICQoJyNjb250YWluZXInKS5tb3VzZWRvd24oZnVuY3Rpb24oZSkge1xuICAgICAgICBydW50aW1lLm1vdXNlRG93biA9IHRydWU7XG4gICAgICAgIC8vZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIH0pO1xuXG4gICAgJCgnI2NvbnRhaW5lcicpLm1vdXNldXAoZnVuY3Rpb24oZSkge1xuICAgICAgICBydW50aW1lLm1vdXNlRG93biA9IGZhbHNlO1xuICAgICAgICAvL2UucHJldmVudERlZmF1bHQoKTtcbiAgICB9KTtcblxuICAgICQoJyNjb250YWluZXInKS5tb3VzZW1vdmUoZnVuY3Rpb24oZSkge1xuICAgICAgICB2YXIgYmIgPSB0aGlzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICB2YXIgYWJzWCA9IGUuY2xpZW50WCAtIGJiLmxlZnQ7XG4gICAgICAgIHZhciBhYnNZID0gZS5jbGllbnRZIC0gYmIudG9wO1xuICAgICAgICBydW50aW1lLm1vdXNlUG9zID0gW2Fic1gtMjQwLCAtYWJzWSsxODBdO1xuICAgIH0pO1xuXG4gICAgLy8gVG91Y2ggZXZlbnRzIC0gRVhQRVJJTUVOVEFMXG4gICAgJCh3aW5kb3cpLmJpbmQoJ3RvdWNoc3RhcnQnLCBmdW5jdGlvbihlKSB7XG4gICAgICAgIC8vIE9uIGlPUywgd2UgbmVlZCB0byBhY3RpdmF0ZSB0aGUgV2ViIEF1ZGlvIEFQSVxuICAgICAgICAvLyB3aXRoIGFuIGVtcHR5IHNvdW5kIHBsYXkgb24gdGhlIGZpcnN0IHRvdWNoIGV2ZW50LlxuICAgICAgICBpZiAoIWlvc0F1ZGlvQWN0aXZlKSB7XG4gICAgICAgICAgICB2YXIgaWJ1ZmZlciA9IHJ1bnRpbWUuYXVkaW9Db250ZXh0LmNyZWF0ZUJ1ZmZlcigxLCAxLCAyMjA1MCk7XG4gICAgICAgICAgICB2YXIgaXNvdXJjZSA9IHJ1bnRpbWUuYXVkaW9Db250ZXh0LmNyZWF0ZUJ1ZmZlclNvdXJjZSgpO1xuICAgICAgICAgICAgaXNvdXJjZS5idWZmZXIgPSBpYnVmZmVyO1xuICAgICAgICAgICAgaXNvdXJjZS5jb25uZWN0KHJ1bnRpbWUuYXVkaW9Db250ZXh0LmRlc3RpbmF0aW9uKTtcbiAgICAgICAgICAgIGlzb3VyY2Uubm90ZU9uKDApO1xuICAgICAgICAgICAgaW9zQXVkaW9BY3RpdmUgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAkKCcjY29udGFpbmVyJykuYmluZCgndG91Y2hzdGFydCcsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgcnVudGltZS5tb3VzZURvd24gPSB0cnVlO1xuICAgIH0pO1xuXG4gICAgJCgnI2NvbnRhaW5lcicpLmJpbmQoJ3RvdWNoZW5kJywgZnVuY3Rpb24oZSkge1xuICAgICAgICBydW50aW1lLm1vdXNlRG93biA9IHRydWU7XG4gICAgfSk7XG5cbiAgICAkKCcjY29udGFpbmVyJykuYmluZCgndG91Y2htb3ZlJywgZnVuY3Rpb24oZSkge1xuICAgICAgICB2YXIgdG91Y2ggPSBlLm9yaWdpbmFsRXZlbnQudG91Y2hlc1swXSB8fCBlLm9yaWdpbmFsRXZlbnQuY2hhbmdlZFRvdWNoZXNbMF07XG4gICAgICAgIHZhciBiYiA9IHRoaXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIHZhciBhYnNYID0gdG91Y2guY2xpZW50WCAtIGJiLmxlZnQ7XG4gICAgICAgIHZhciBhYnNZID0gdG91Y2guY2xpZW50WSAtIGJiLnRvcDtcbiAgICAgICAgcnVudGltZS5tb3VzZVBvcyA9IFthYnNYLTI0MCwgLWFic1krMTgwXTtcbiAgICB9KTtcblxuICAgIC8vIEJvcmRlciB0b3VjaCBldmVudHMgLSBFWFBFUklNRU5UQUxcbiAgICAkKCcjbGVmdCcpLmJpbmQoJ3RvdWNoc3RhcnQgdG91Y2htb3ZlJywgZnVuY3Rpb24oZSkgeyBydW50aW1lLmtleXNEb3duWzM3XSA9IHRydWU7IHJ1bnRpbWUuc3RhcnRLZXlIYXRzKDM3KTsgfSk7XG4gICAgJCgnI2xlZnQnKS5iaW5kKCd0b3VjaGVuZCcsIGZ1bmN0aW9uKGUpIHsgZGVsZXRlIHJ1bnRpbWUua2V5c0Rvd25bMzddOyB9KTtcbiAgICAkKCcjdXAnKS5iaW5kKCd0b3VjaHN0YXJ0IHRvdWNobW92ZScsIGZ1bmN0aW9uKGUpIHsgcnVudGltZS5rZXlzRG93blszOF0gPSB0cnVlOyBydW50aW1lLnN0YXJ0S2V5SGF0cygzOCk7IH0pO1xuICAgICQoJyN1cCcpLmJpbmQoJ3RvdWNoZW5kJywgZnVuY3Rpb24oZSkgeyBkZWxldGUgcnVudGltZS5rZXlzRG93blszOF07IH0pO1xuICAgICQoJyNyaWdodCcpLmJpbmQoJ3RvdWNoc3RhcnQgdG91Y2htb3ZlJywgZnVuY3Rpb24oZSkgeyBydW50aW1lLmtleXNEb3duWzM5XSA9IHRydWU7IHJ1bnRpbWUuc3RhcnRLZXlIYXRzKDM5KTsgfSk7XG4gICAgJCgnI3JpZ2h0JykuYmluZCgndG91Y2hlbmQnLCBmdW5jdGlvbihlKSB7IGRlbGV0ZSBydW50aW1lLmtleXNEb3duWzM5XTsgfSk7XG4gICAgJCgnI2Rvd24nKS5iaW5kKCd0b3VjaHN0YXJ0IHRvdWNobW92ZScsIGZ1bmN0aW9uKGUpIHsgcnVudGltZS5rZXlzRG93bls0MF0gPSB0cnVlOyBydW50aW1lLnN0YXJ0S2V5SGF0cyg0MCk7IH0pO1xuICAgICQoJyNkb3duJykuYmluZCgndG91Y2hlbmQnLCBmdW5jdGlvbihlKSB7IGRlbGV0ZSBydW50aW1lLmtleXNEb3duWzQwXTsgfSk7XG5cbiAgICAvLyBMb2FkIHRoZSBpbnRlcnByZXRlciBhbmQgcHJpbWl0aXZlc1xuICAgIGdsb2JhbC5pbnRlcnAgPSBuZXcgSW50ZXJwcmV0ZXIoKTtcbiAgICBpbnRlcnAuaW5pdFByaW1zKCk7XG5cbiAgICAvLyBMb2FkIHRoZSByZXF1ZXN0ZWQgcHJvamVjdCBhbmQgZ28hXG4gICAgZ2xvYmFsLmlvID0gbmV3IElPKCk7XG4gICAgaW8ubG9hZFByb2plY3QocHJvamVjdF9pZCk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNjcmF0Y2g7XG5cbn0pLmNhbGwodGhpcyx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30pIiwiLy8gQ29weXJpZ2h0IChDKSAyMDEzIE1hc3NhY2h1c2V0dHMgSW5zdGl0dXRlIG9mIFRlY2hub2xvZ3lcbi8vXG4vLyBUaGlzIHByb2dyYW0gaXMgZnJlZSBzb2Z0d2FyZTsgeW91IGNhbiByZWRpc3RyaWJ1dGUgaXQgYW5kL29yXG4vLyBtb2RpZnkgaXQgdW5kZXIgdGhlIHRlcm1zIG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZSB2ZXJzaW9uIDIsXG4vLyBhcyBwdWJsaXNoZWQgYnkgdGhlIEZyZWUgU29mdHdhcmUgRm91bmRhdGlvbi5cbi8vXG4vLyBUaGlzIHByb2dyYW0gaXMgZGlzdHJpYnV0ZWQgaW4gdGhlIGhvcGUgdGhhdCBpdCB3aWxsIGJlIHVzZWZ1bCxcbi8vIGJ1dCBXSVRIT1VUIEFOWSBXQVJSQU5UWTsgd2l0aG91dCBldmVuIHRoZSBpbXBsaWVkIHdhcnJhbnR5IG9mXG4vLyBNRVJDSEFOVEFCSUxJVFkgb3IgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UuICBTZWUgdGhlXG4vLyBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuLy9cbi8vIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlXG4vLyBhbG9uZyB3aXRoIHRoaXMgcHJvZ3JhbTsgaWYgbm90LCB3cml0ZSB0byB0aGUgRnJlZSBTb2Z0d2FyZVxuLy8gRm91bmRhdGlvbiwgSW5jLiwgNTEgRnJhbmtsaW4gU3RyZWV0LCBGaWZ0aCBGbG9vciwgQm9zdG9uLCBNQSAgMDIxMTAtMTMwMSwgVVNBLlxuXG4vLyBTY3JhdGNoIEhUTUw1IFBsYXllclxuLy8gU3ByaXRlLmpzXG4vLyBUaW0gTWlja2VsLCBKdWx5IDIwMTEgLSBNYXJjaCAyMDEyXG5cbi8vIFRoZSBTcHJpdGUgcHJvdmlkZXMgdGhlIGludGVyZmFjZSBhbmQgaW1wbGVtZW50YXRpb24gZm9yIFNjcmF0Y2ggc3ByaXRlLWNvbnRyb2xcblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgQ29sb3IgPSByZXF1aXJlKCcuL3V0aWwvQ29sb3InKSxcbiAgICBSZWN0YW5nbGUgPSByZXF1aXJlKCcuL3V0aWwvUmVjdGFuZ2xlJyk7XG5cbnZhciBTcHJpdGUgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgaWYgKCF0aGlzLmRhdGEpIHtcbiAgICAgICAgdGhpcy5kYXRhID0gZGF0YTtcbiAgICB9XG5cbiAgICAvLyBQdWJsaWMgdmFyaWFibGVzIHVzZWQgZm9yIFNjcmF0Y2gtYWNjZXNzaWJsZSBkYXRhLlxuICAgIHRoaXMudmlzaWJsZSA9IHR5cGVvZih0aGlzLmRhdGEudmlzaWJsZSkgPT0gXCJ1bmRlZmluZWRcIiA/IHRydWUgOiBkYXRhLnZpc2libGU7XG5cbiAgICB0aGlzLnNjcmF0Y2hYID0gZGF0YS5zY3JhdGNoWCB8fCAwO1xuICAgIHRoaXMuc2NyYXRjaFkgPSBkYXRhLnNjcmF0Y2hZIHx8IDA7XG5cbiAgICB0aGlzLnNjYWxlID0gZGF0YS5zY2FsZSB8fCAxLjA7XG5cbiAgICB0aGlzLmRpcmVjdGlvbiA9IGRhdGEuZGlyZWN0aW9uIHx8IDkwO1xuICAgIHRoaXMucm90YXRpb24gPSAoZGF0YS5kaXJlY3Rpb24gLSA5MCkgfHwgMDtcbiAgICB0aGlzLnJvdGF0aW9uU3R5bGUgPSBkYXRhLnJvdGF0aW9uU3R5bGUgfHwgJ25vcm1hbCc7XG4gICAgdGhpcy5pc0ZsaXBwZWQgPSBkYXRhLmRpcmVjdGlvbiA8IDAgJiYgZGF0YS5yb3RhdGlvblN0eWxlID09ICdsZWZ0UmlnaHQnO1xuICAgIHRoaXMuY29zdHVtZXMgPSBkYXRhLmNvc3R1bWVzIHx8IFtdO1xuICAgIHRoaXMuY3VycmVudENvc3R1bWVJbmRleCA9IGRhdGEuY3VycmVudENvc3R1bWVJbmRleCB8fCAwO1xuICAgIHRoaXMucHJldmlvdXNDb3N0dW1lSW5kZXggPSAtMTtcblxuICAgIHRoaXMub2JqTmFtZSA9IGRhdGEub2JqTmFtZSB8fCAnJztcblxuICAgIHRoaXMudmFyaWFibGVzID0ge307XG4gICAgaWYgKGRhdGEudmFyaWFibGVzKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZGF0YS52YXJpYWJsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHRoaXMudmFyaWFibGVzW2RhdGEudmFyaWFibGVzW2ldWyduYW1lJ11dID0gZGF0YS52YXJpYWJsZXNbaV1bJ3ZhbHVlJ107XG4gICAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5saXN0cyA9IHt9O1xuICAgIGlmIChkYXRhLmxpc3RzKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZGF0YS5saXN0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdGhpcy5saXN0c1tkYXRhLmxpc3RzW2ldWydsaXN0TmFtZSddXSA9IGRhdGEubGlzdHNbaV07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBVc2VkIGZvciB0aGUgcGVuXG4gICAgdGhpcy5wZW5Jc0Rvd24gPSBmYWxzZTtcbiAgICB0aGlzLnBlbldpZHRoID0gMTtcbiAgICB0aGlzLnBlbkh1ZSA9IDEyMDsgLy8gYmx1ZVxuICAgIHRoaXMucGVuU2hhZGUgPSA1MDsgLy8gZnVsbCBicmlnaHRuZXNzIGFuZCBzYXR1cmF0aW9uXG4gICAgdGhpcy5wZW5Db2xvckNhY2hlID0gMHgwMDAwRkY7XG5cbiAgICAvLyBVc2VkIGZvciBsYXllcmluZ1xuICAgIGlmICghdGhpcy56KSB0aGlzLnogPSBpby5nZXRDb3VudCgpO1xuXG4gICAgLy8gSFRNTCBlbGVtZW50IGZvciB0aGUgdGFsayBidWJibGVzXG4gICAgdGhpcy50YWxrQnViYmxlID0gbnVsbDtcbiAgICB0aGlzLnRhbGtCdWJibGVCb3ggPSBudWxsO1xuICAgIHRoaXMudGFsa0J1YmJsZVN0eWxlciA9IG51bGw7XG4gICAgdGhpcy50YWxrQnViYmxlT24gPSBmYWxzZTtcblxuICAgIC8vIEhUTUwgZWxlbWVudCBmb3IgdGhlIGFzayBidWJibGVzXG4gICAgdGhpcy5hc2tJbnB1dCA9IG51bGw7XG4gICAgdGhpcy5hc2tJbnB1dEZpZWxkID0gbnVsbDtcbiAgICB0aGlzLmFza0lucHV0QnV0dG9uID0gbnVsbDtcbiAgICB0aGlzLmFza0lucHV0T24gPSBmYWxzZTtcblxuICAgIC8vIEludGVybmFsIHZhcmlhYmxlcyB1c2VkIGZvciByZW5kZXJpbmcgbWVzaGVzLlxuICAgIHRoaXMudGV4dHVyZXMgPSBbXTtcbiAgICB0aGlzLm1hdGVyaWFscyA9IFtdO1xuICAgIHRoaXMuZ2VvbWV0cmllcyA9IFtdO1xuICAgIHRoaXMubWVzaCA9IG51bGw7XG5cbiAgICAvLyBTb3VuZCBidWZmZXJzIGFuZCBkYXRhXG4gICAgdGhpcy5zb3VuZHMgPSB7fTtcbiAgICBpZiAoZGF0YS5zb3VuZHMpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkYXRhLnNvdW5kcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdGhpcy5zb3VuZHNbZGF0YS5zb3VuZHNbaV1bJ3NvdW5kTmFtZSddXSA9IGRhdGEuc291bmRzW2ldO1xuICAgICAgICB9XG4gICAgfVxuICAgIHRoaXMuc291bmRzTG9hZGVkID0gMDtcbiAgICB0aGlzLmluc3RydW1lbnQgPSAxO1xuXG4gICAgLy8gSW1hZ2UgZWZmZWN0c1xuICAgIHRoaXMuZmlsdGVycyA9IHtcbiAgICAgICAgY29sb3I6IDAsXG4gICAgICAgIGZpc2hleWU6IDAsXG4gICAgICAgIHdoaXJsOiAwLFxuICAgICAgICBwaXhlbGF0ZTogMCxcbiAgICAgICAgbW9zYWljOiAwLFxuICAgICAgICBicmlnaHRuZXNzOiAwLFxuICAgICAgICBnaG9zdDogMFxuICAgIH07XG5cbiAgICAvLyBJbmNyZW1lbnRlZCB3aGVuIGltYWdlcyBhcmUgbG9hZGVkIGJ5IHRoZSBicm93c2VyLlxuICAgIHRoaXMuY29zdHVtZXNMb2FkZWQgPSAwO1xuXG4gICAgLy8gU3RhY2tzIHRvIGJlIHB1c2hlZCB0byB0aGUgaW50ZXJwcmV0ZXIgYW5kIHJ1blxuICAgIHRoaXMuc3RhY2tzID0gW107XG59O1xuXG4vLyBBdHRhY2hlcyBhIFNwcml0ZSAoPGltZz4pIHRvIGEgU2NyYXRjaCBzY2VuZVxuU3ByaXRlLnByb3RvdHlwZS5hdHRhY2ggPSBmdW5jdGlvbihzY2VuZSkge1xuICAgIC8vIENyZWF0ZSB0ZXh0dXJlcyBhbmQgbWF0ZXJpYWxzIGZvciBlYWNoIG9mIHRoZSBjb3N0dW1lcy5cbiAgICBmb3IgKHZhciBjIGluIHRoaXMuY29zdHVtZXMpIHtcbiAgICAgICAgdGhpcy50ZXh0dXJlc1tjXSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2ltZycpO1xuICAgICAgICAkKHRoaXMudGV4dHVyZXNbY10pXG4gICAgICAgIC5sb2FkKFt0aGlzLCBjXSwgZnVuY3Rpb24oZXZvKSB7XG4gICAgICAgICAgICB2YXIgc3ByaXRlID0gZXZvLmhhbmRsZU9iai5kYXRhWzBdO1xuICAgICAgICAgICAgdmFyIGMgPSBldm8uaGFuZGxlT2JqLmRhdGFbMV07XG5cbiAgICAgICAgICAgIHNwcml0ZS5jb3N0dW1lc0xvYWRlZCArPSAxO1xuICAgICAgICAgICAgc3ByaXRlLnVwZGF0ZUNvc3R1bWUoKTtcblxuICAgICAgICAgICAgJChzcHJpdGUudGV4dHVyZXNbY10pLmNzcygnZGlzcGxheScsIHNwcml0ZS5jdXJyZW50Q29zdHVtZUluZGV4ID09IGMgPyAnaW5saW5lJyA6ICdub25lJyk7XG4gICAgICAgICAgICAkKHNwcml0ZS50ZXh0dXJlc1tjXSkuY3NzKCdwb3NpdGlvbicsICdhYnNvbHV0ZScpLmNzcygnbGVmdCcsICcwcHgnKS5jc3MoJ3RvcCcsICcwcHgnKTtcbiAgICAgICAgICAgICQoc3ByaXRlLnRleHR1cmVzW2NdKS5iaW5kKCdkcmFnc3RhcnQnLCBmdW5jdGlvbihldnQpIHsgZXZ0LnByZXZlbnREZWZhdWx0KCk7IH0pXG4gICAgICAgICAgICAgICAgLmJpbmQoJ3NlbGVjdHN0YXJ0JywgZnVuY3Rpb24oZXZ0KSB7IGV2dC5wcmV2ZW50RGVmYXVsdCgpOyB9KVxuICAgICAgICAgICAgICAgIC5iaW5kKCd0b3VjaGVuZCcsIGZ1bmN0aW9uKGV2dCkgeyBzcHJpdGUub25DbGljayhldnQpOyAkKHRoaXMpLmFkZENsYXNzKCd0b3VjaGVkJyk7IH0pXG4gICAgICAgICAgICAgICAgLmNsaWNrKGZ1bmN0aW9uKGV2dCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoISQodGhpcykuaGFzQ2xhc3MoJ3RvdWNoZWQnKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3ByaXRlLm9uQ2xpY2soZXZ0KTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICQodGhpcykucmVtb3ZlQ2xhc3MoJ3RvdWNoZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgc2NlbmUuYXBwZW5kKCQoc3ByaXRlLnRleHR1cmVzW2NdKSk7XG4gICAgICAgIH0pXG4gICAgICAgIC5hdHRyKHtcbiAgICAgICAgICAgICdjcm9zc09yaWdpbic6ICdhbm5vbnltb3VzJyxcbiAgICAgICAgICAgICdzcmMnOiBpby5hc3NldF9iYXNlICsgdGhpcy5jb3N0dW1lc1tjXS5iYXNlTGF5ZXJNRDUgKyBpby5hc3NldF9zdWZmaXhcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5tZXNoID0gdGhpcy50ZXh0dXJlc1t0aGlzLmN1cnJlbnRDb3N0dW1lSW5kZXhdO1xuICAgIHRoaXMudXBkYXRlTGF5ZXIoKTtcbiAgICB0aGlzLnVwZGF0ZVZpc2libGUoKTtcbiAgICB0aGlzLnVwZGF0ZVRyYW5zZm9ybSgpO1xuXG4gICAgaWYgKCEgdGhpcy5pc1N0YWdlKSB7XG4gICAgICAgIHRoaXMudGFsa0J1YmJsZSA9ICQoJzxkaXYgY2xhc3M9XCJidWJibGUtY29udGFpbmVyXCI+PC9kaXY+Jyk7XG4gICAgICAgIHRoaXMudGFsa0J1YmJsZS5jc3MoJ2Rpc3BsYXknLCAnbm9uZScpO1xuICAgICAgICB0aGlzLnRhbGtCdWJibGVCb3ggPSAkKCc8ZGl2IGNsYXNzPVwiYnViYmxlXCI+PC9kaXY+Jyk7XG4gICAgICAgIHRoaXMudGFsa0J1YmJsZVN0eWxlciA9ICQoJzxkaXYgY2xhc3M9XCJidWJibGUtc2F5XCI+PC9kaXY+Jyk7XG4gICAgICAgIHRoaXMudGFsa0J1YmJsZS5hcHBlbmQodGhpcy50YWxrQnViYmxlQm94KTtcbiAgICAgICAgdGhpcy50YWxrQnViYmxlLmFwcGVuZCh0aGlzLnRhbGtCdWJibGVTdHlsZXIpO1xuICAgIH1cblxuICAgIHRoaXMuYXNrSW5wdXQgPSAkKCc8ZGl2IGNsYXNzPVwiYXNrLWNvbnRhaW5lclwiPjwvZGl2PicpO1xuICAgIHRoaXMuYXNrSW5wdXQuY3NzKCdkaXNwbGF5JywgJ25vbmUnKTtcbiAgICB0aGlzLmFza0lucHV0RmllbGQgPSAkKCc8ZGl2IGNsYXNzPVwiYXNrLWZpZWxkXCI+PC9kaXY+Jyk7XG4gICAgdGhpcy5hc2tJbnB1dFRleHRGaWVsZCA9ICQoJzxpbnB1dCB0eXBlPVwidGV4dFwiIGNsYXNzPVwiYXNrLXRleHQtZmllbGRcIj48L2lucHV0PicpO1xuICAgIHRoaXMuYXNrSW5wdXRGaWVsZC5hcHBlbmQodGhpcy5hc2tJbnB1dFRleHRGaWVsZCk7XG4gICAgdGhpcy5hc2tJbnB1dEJ1dHRvbiA9ICQoJzxkaXYgY2xhc3M9XCJhc2stYnV0dG9uXCI+PC9kaXY+Jyk7XG4gICAgdGhpcy5iaW5kRG9Bc2tCdXR0b24oKTtcbiAgICB0aGlzLmFza0lucHV0LmFwcGVuZCh0aGlzLmFza0lucHV0RmllbGQpO1xuICAgIHRoaXMuYXNrSW5wdXQuYXBwZW5kKHRoaXMuYXNrSW5wdXRCdXR0b24pO1xuXG4gICAgcnVudGltZS5zY2VuZS5hcHBlbmQodGhpcy50YWxrQnViYmxlKTtcbiAgICBydW50aW1lLnNjZW5lLmFwcGVuZCh0aGlzLmFza0lucHV0KTtcbn07XG5cbi8vIExvYWQgc291bmRzIGZyb20gdGhlIHNlcnZlciBhbmQgYnVmZmVyIHRoZW1cblNwcml0ZS5wcm90b3R5cGUubG9hZFNvdW5kcyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAkLmVhY2godGhpcy5zb3VuZHMsIGZ1bmN0aW9uKGluZGV4LCBzb3VuZCkge1xuICAgICAgICBpby5zb3VuZFJlcXVlc3Qoc291bmQsIHNlbGYpO1xuICAgIH0pO1xufTtcblxuLy8gVHJ1ZSB3aGVuIGFsbCB0aGUgY29zdHVtZXMgaGF2ZSBiZWVuIGxvYWRlZFxuU3ByaXRlLnByb3RvdHlwZS5pc0xvYWRlZCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmNvc3R1bWVzTG9hZGVkID09IHRoaXMuY29zdHVtZXMubGVuZ3RoICYmIHRoaXMuc291bmRzTG9hZGVkID09IE9iamVjdC5rZXlzKHRoaXMuc291bmRzKS5sZW5ndGg7XG59O1xuXG4vLyBTdGVwIG1ldGhvZHNcblNwcml0ZS5wcm90b3R5cGUuc2hvd0Nvc3R1bWUgPSBmdW5jdGlvbihjb3N0dW1lKSB7XG4gICAgaWYgKGNvc3R1bWUgPCAwKSB7XG4gICAgICAgIGNvc3R1bWUgKz0gdGhpcy5jb3N0dW1lcy5sZW5ndGg7XG4gICAgfVxuICAgIGlmICghdGhpcy50ZXh0dXJlc1tjb3N0dW1lXSkge1xuICAgICAgICB0aGlzLmN1cnJlbnRDb3N0dW1lSW5kZXggPSAwO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdGhpcy5jdXJyZW50Q29zdHVtZUluZGV4ID0gY29zdHVtZTtcbiAgICB9XG4gICAgdGhpcy51cGRhdGVDb3N0dW1lKCk7XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLmluZGV4T2ZDb3N0dW1lTmFtZWQgPSBmdW5jdGlvbihuYW1lKSB7XG4gICAgZm9yICh2YXIgaSBpbiB0aGlzLmNvc3R1bWVzKSB7XG4gICAgICAgIHZhciBjID0gdGhpcy5jb3N0dW1lc1tpXTtcbiAgICAgICAgaWYgKGNbJ2Nvc3R1bWVOYW1lJ10gPT0gbmFtZSkge1xuICAgICAgICAgICAgcmV0dXJuIGk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLnNob3dDb3N0dW1lTmFtZWQgPSBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGluZGV4ID0gdGhpcy5pbmRleE9mQ29zdHVtZU5hbWVkKG5hbWUpO1xuICAgIGlmICghaW5kZXgpIHJldHVybjtcbiAgICB0aGlzLnNob3dDb3N0dW1lKGluZGV4KTtcbn07XG5cblNwcml0ZS5wcm90b3R5cGUudXBkYXRlQ29zdHVtZSA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy50ZXh0dXJlc1t0aGlzLmN1cnJlbnRDb3N0dW1lSW5kZXhdKSB7XG4gICAgICAgIHRoaXMuY3VycmVudENvc3R1bWVJbmRleCA9IDA7XG4gICAgfVxuICAgICQodGhpcy5tZXNoKS5jc3MoJ2Rpc3BsYXknLCAnbm9uZScpO1xuICAgIHRoaXMubWVzaCA9IHRoaXMudGV4dHVyZXNbdGhpcy5jdXJyZW50Q29zdHVtZUluZGV4XTtcbiAgICB0aGlzLnVwZGF0ZVZpc2libGUoKTtcbiAgICB0aGlzLnVwZGF0ZVRyYW5zZm9ybSgpO1xufTtcblxuU3ByaXRlLnByb3RvdHlwZS5vbkNsaWNrID0gZnVuY3Rpb24oZXZ0KSB7XG4gICAgLy8gVE9ETyAtIG5lZWRzIHdvcmshIVxuXG4gICAgLy8gV2UgZG9uJ3QgbmVlZCBib3hPZmZzZXQgYW55bW9yZS5cbiAgICB2YXIgbW91c2VYID0gcnVudGltZS5tb3VzZVBvc1swXSArIDI0MDtcbiAgICB2YXIgbW91c2VZID0gMTgwIC0gcnVudGltZS5tb3VzZVBvc1sxXTtcblxuICAgIGlmICh0aGlzLm1lc2guc3JjLmluZGV4T2YoJy5zdmcnKSA9PSAtMSkge1xuICAgICAgICAvLyBIQUNLIC0gaWYgdGhlIGltYWdlIFNSQyBkb2Vzbid0IGluZGljYXRlIGl0J3MgYW4gU1ZHLFxuICAgICAgICAvLyB0aGVuIHdlJ2xsIHRyeSB0byBkZXRlY3QgaWYgdGhlIHBvaW50IHdlIGNsaWNrZWQgaXMgdHJhbnNwYXJlbnRcbiAgICAgICAgLy8gYnkgcmVuZGVyaW5nIHRoZSBzcHJpdGUgb24gYSBjYW52YXMuICBXaXRoIGFuIFNWRyxcbiAgICAgICAgLy8gd2UgYXJlIGZvcmNlZCBub3QgdG8gZG8gdGhpcyBmb3Igbm93IGJ5IENocm9tZS9XZWJraXQgU09QOlxuICAgICAgICAvLyBodHRwOi8vY29kZS5nb29nbGUuY29tL3AvY2hyb21pdW0vaXNzdWVzL2RldGFpbD9pZD02ODU2OFxuICAgICAgICB2YXIgY2FudiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICAgICAgICBjYW52LndpZHRoID0gNDgwO1xuICAgICAgICBjYW52LmhlaWdodCA9IDM2MDtcbiAgICAgICAgdmFyIGN0eCA9IGNhbnYuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICAgICAgdmFyIGRyYXdXaWR0aCA9IHRoaXMudGV4dHVyZXNbdGhpcy5jdXJyZW50Q29zdHVtZUluZGV4XS53aWR0aDtcbiAgICAgICAgdmFyIGRyYXdIZWlnaHQgPSB0aGlzLnRleHR1cmVzW3RoaXMuY3VycmVudENvc3R1bWVJbmRleF0uaGVpZ2h0O1xuICAgICAgICB2YXIgc2NhbGUgPSB0aGlzLnNjYWxlIC8gKHRoaXMuY29zdHVtZXNbdGhpcy5jdXJyZW50Q29zdHVtZUluZGV4XS5iaXRtYXBSZXNvbHV0aW9uIHx8IDEpO1xuICAgICAgICB2YXIgcm90YXRpb25DZW50ZXJYID0gdGhpcy5jb3N0dW1lc1t0aGlzLmN1cnJlbnRDb3N0dW1lSW5kZXhdLnJvdGF0aW9uQ2VudGVyWDtcbiAgICAgICAgdmFyIHJvdGF0aW9uQ2VudGVyWSA9IHRoaXMuY29zdHVtZXNbdGhpcy5jdXJyZW50Q29zdHVtZUluZGV4XS5yb3RhdGlvbkNlbnRlclk7XG4gICAgICAgIGN0eC50cmFuc2xhdGUoMjQwICsgdGhpcy5zY3JhdGNoWCwgMTgwIC0gdGhpcy5zY3JhdGNoWSk7XG4gICAgICAgIGN0eC5yb3RhdGUodGhpcy5yb3RhdGlvbiAqIE1hdGguUEkgLyAxODAuMCk7XG4gICAgICAgIGN0eC5zY2FsZShzY2FsZSwgc2NhbGUpO1xuICAgICAgICBjdHgudHJhbnNsYXRlKC1yb3RhdGlvbkNlbnRlclgsIC1yb3RhdGlvbkNlbnRlclkpO1xuICAgICAgICBjdHguZHJhd0ltYWdlKHRoaXMubWVzaCwgMCwgMCk7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoY2Fudik7XG5cbiAgICAgICAgdmFyIGlkYXRhID0gY3R4LmdldEltYWdlRGF0YShtb3VzZVgsIG1vdXNlWSwgMSwgMSkuZGF0YTtcbiAgICAgICAgdmFyIGFscGhhID0gaWRhdGFbM107XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGFscGhhID0gMTtcbiAgICB9XG5cbiAgICBpZiAoYWxwaGEgPiAwKSB7XG4gICAgICAgIC8vIFN0YXJ0IGNsaWNrZWQgaGF0cyBpZiB0aGUgcGl4ZWwgaXMgbm9uLXRyYW5zcGFyZW50XG4gICAgICAgIHJ1bnRpbWUuc3RhcnRDbGlja2VkSGF0cyh0aGlzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBPdGhlcndpc2UsIG1vdmUgYmFjayBhIGxheWVyIGFuZCB0cmlnZ2VyIHRoZSBjbGljayBldmVudFxuICAgICAgICAkKHRoaXMubWVzaCkuaGlkZSgpO1xuICAgICAgICB2YXIgYmIgPSAkKCcjY29udGFpbmVyJylbMF0uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIHZhciB1bmRlckVsZW1lbnQgPSBkb2N1bWVudC5lbGVtZW50RnJvbVBvaW50KGJiLmxlZnQgKyBtb3VzZVgsIGJiLnRvcCArIG1vdXNlWSk7XG4gICAgICAgICQodW5kZXJFbGVtZW50KS5jbGljaygpO1xuICAgICAgICAkKHRoaXMubWVzaCkuc2hvdygpO1xuICAgIH1cbn07XG5cblNwcml0ZS5wcm90b3R5cGUuc2V0VmlzaWJsZSA9IGZ1bmN0aW9uKHYpIHtcbiAgICB0aGlzLnZpc2libGUgPSB2O1xuICAgIHRoaXMudXBkYXRlVmlzaWJsZSgpO1xufTtcblxuU3ByaXRlLnByb3RvdHlwZS51cGRhdGVMYXllciA9IGZ1bmN0aW9uKCkge1xuICAgICQodGhpcy5tZXNoKS5jc3MoJ3otaW5kZXgnLCB0aGlzLnopO1xuICAgIGlmICh0aGlzLnRhbGtCdWJibGUpIHRoaXMudGFsa0J1YmJsZS5jc3MoJ3otaW5kZXgnLCB0aGlzLnopO1xuICAgIGlmICh0aGlzLmFza0lucHV0KSB0aGlzLmFza0lucHV0LmNzcygnei1pbmRleCcsIHRoaXMueik7XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLnVwZGF0ZVZpc2libGUgPSBmdW5jdGlvbigpIHtcbiAgICAkKHRoaXMubWVzaCkuY3NzKCdkaXNwbGF5JywgdGhpcy52aXNpYmxlID8gJ2lubGluZScgOiAnbm9uZScpO1xuICAgIGlmICh0aGlzLnRhbGtCdWJibGVPbikgdGhpcy50YWxrQnViYmxlLmNzcygnZGlzcGxheScsIHRoaXMudmlzaWJsZSA/ICdpbmxpbmUtYmxvY2snIDogJ25vbmUnKTtcbiAgICBpZiAodGhpcy5hc2tJbnB1dE9uKSB0aGlzLmFza0lucHV0LmNzcygnZGlzcGxheScsIHRoaXMudmlzaWJsZSA/ICdpbmxpbmUtYmxvY2snIDogJ25vbmUnKTtcbn07XG5cblNwcml0ZS5wcm90b3R5cGUudXBkYXRlVHJhbnNmb3JtID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHRleHR1cmUgPSB0aGlzLnRleHR1cmVzW3RoaXMuY3VycmVudENvc3R1bWVJbmRleF07XG4gICAgdmFyIHJlc29sdXRpb24gPSB0aGlzLmNvc3R1bWVzW3RoaXMuY3VycmVudENvc3R1bWVJbmRleF0uYml0bWFwUmVzb2x1dGlvbiB8fCAxO1xuXG4gICAgdmFyIGRyYXdXaWR0aCA9IHRleHR1cmUud2lkdGggKiB0aGlzLnNjYWxlIC8gcmVzb2x1dGlvbjtcbiAgICB2YXIgZHJhd0hlaWdodCA9IHRleHR1cmUuaGVpZ2h0ICogdGhpcy5zY2FsZSAvIHJlc29sdXRpb247XG5cbiAgICB2YXIgcm90YXRpb25DZW50ZXJYID0gdGhpcy5jb3N0dW1lc1t0aGlzLmN1cnJlbnRDb3N0dW1lSW5kZXhdLnJvdGF0aW9uQ2VudGVyWDtcbiAgICB2YXIgcm90YXRpb25DZW50ZXJZID0gdGhpcy5jb3N0dW1lc1t0aGlzLmN1cnJlbnRDb3N0dW1lSW5kZXhdLnJvdGF0aW9uQ2VudGVyWTtcblxuICAgIHZhciBkcmF3WCA9IHRoaXMuc2NyYXRjaFggKyAoNDgwIC8gMikgLSByb3RhdGlvbkNlbnRlclg7XG4gICAgdmFyIGRyYXdZID0gLXRoaXMuc2NyYXRjaFkgKyAoMzYwIC8gMikgLSByb3RhdGlvbkNlbnRlclk7XG5cbiAgICB2YXIgc2NhbGVYcHJlcGVuZCA9ICcnO1xuICAgIGlmICh0aGlzLmlzRmxpcHBlZCkge1xuICAgICAgICBzY2FsZVhwcmVwZW5kID0gJy0nOyAvLyBGb3IgYSBsZWZ0UmlnaHQgZmxpcCwgd2UgYWRkIGEgbWludXNcbiAgICAgICAgLy8gc2lnbiB0byB0aGUgWCBzY2FsZS5cbiAgICB9XG5cbiAgICAkKHRoaXMubWVzaCkuY3NzKFxuICAgICAgICAndHJhbnNmb3JtJyxcbiAgICAgICAgJ3RyYW5zbGF0ZXgoJyArIGRyYXdYICsgJ3B4KSAnICtcbiAgICAgICAgJ3RyYW5zbGF0ZXkoJyArIGRyYXdZICsgJ3B4KSAnICtcbiAgICAgICAgJ3JvdGF0ZSgnICsgdGhpcy5yb3RhdGlvbiArICdkZWcpICcgK1xuICAgICAgICAnc2NhbGVYKCcgKyBzY2FsZVhwcmVwZW5kICsgKHRoaXMuc2NhbGUgLyByZXNvbHV0aW9uKSArICcpIHNjYWxlWSgnICsgICh0aGlzLnNjYWxlIC8gcmVzb2x1dGlvbikgKyAnKSdcbiAgICApO1xuICAgICQodGhpcy5tZXNoKS5jc3MoXG4gICAgICAgICctbW96LXRyYW5zZm9ybScsXG4gICAgICAgICd0cmFuc2xhdGV4KCcgKyBkcmF3WCArICdweCkgJyArXG4gICAgICAgICd0cmFuc2xhdGV5KCcgKyBkcmF3WSArICdweCkgJyArXG4gICAgICAgICdyb3RhdGUoJyArIHRoaXMucm90YXRpb24gKyAnZGVnKSAnICtcbiAgICAgICAgJ3NjYWxlWCgnICsgc2NhbGVYcHJlcGVuZCArIHRoaXMuc2NhbGUgKyAnKSBzY2FsZVkoJyArICB0aGlzLnNjYWxlIC8gcmVzb2x1dGlvbiArICcpJ1xuICAgICk7XG4gICAgJCh0aGlzLm1lc2gpLmNzcyhcbiAgICAgICAgJy13ZWJraXQtdHJhbnNmb3JtJyxcbiAgICAgICAgJ3RyYW5zbGF0ZXgoJyArIGRyYXdYICsgJ3B4KSAnICtcbiAgICAgICAgJ3RyYW5zbGF0ZXkoJyArIGRyYXdZICsgJ3B4KSAnICtcbiAgICAgICAgJ3JvdGF0ZSgnICsgdGhpcy5yb3RhdGlvbiArICdkZWcpICcgK1xuICAgICAgICAnc2NhbGVYKCcgKyBzY2FsZVhwcmVwZW5kICsgKHRoaXMuc2NhbGUgLyByZXNvbHV0aW9uKSArICcpIHNjYWxlWSgnICsgICh0aGlzLnNjYWxlIC8gcmVzb2x1dGlvbikgKyAnKSdcbiAgICApO1xuXG4gICAgJCh0aGlzLm1lc2gpLmNzcygnLXdlYmtpdC10cmFuc2Zvcm0tb3JpZ2luJywgcm90YXRpb25DZW50ZXJYICsgJ3B4ICcgKyByb3RhdGlvbkNlbnRlclkgKyAncHgnKTtcbiAgICAkKHRoaXMubWVzaCkuY3NzKCctbW96LXRyYW5zZm9ybS1vcmlnaW4nLCByb3RhdGlvbkNlbnRlclggKyAncHggJyArIHJvdGF0aW9uQ2VudGVyWSArICdweCcpO1xuICAgICQodGhpcy5tZXNoKS5jc3MoJy1tcy10cmFuc2Zvcm0tb3JpZ2luJywgcm90YXRpb25DZW50ZXJYICsgJ3B4ICcgKyByb3RhdGlvbkNlbnRlclkgKyAncHgnKTtcbiAgICAkKHRoaXMubWVzaCkuY3NzKCctby10cmFuc2Zvcm0tb3JpZ2luJywgcm90YXRpb25DZW50ZXJYICsgJ3B4ICcgKyByb3RhdGlvbkNlbnRlclkgKyAncHgnKTtcbiAgICAkKHRoaXMubWVzaCkuY3NzKCd0cmFuc2Zvcm0tb3JpZ2luJywgcm90YXRpb25DZW50ZXJYICsgJ3B4ICcgKyByb3RhdGlvbkNlbnRlclkgKyAncHgnKTtcblxuICAgIC8vIERvbid0IGZvcmdldCB0byB1cGRhdGUgdGhlIHRhbGsgYnViYmxlLlxuICAgIGlmICh0aGlzLnRhbGtCdWJibGUpIHtcbiAgICAgICAgdmFyIHh5ID0gdGhpcy5nZXRUYWxrQnViYmxlWFkoKTtcbiAgICAgICAgdGhpcy50YWxrQnViYmxlLmNzcygnbGVmdCcsIHh5WzBdICsgJ3B4Jyk7XG4gICAgICAgIHRoaXMudGFsa0J1YmJsZS5jc3MoJ3RvcCcsIHh5WzFdICsgJ3B4Jyk7XG4gICAgfVxuXG4gICAgdGhpcy51cGRhdGVMYXllcigpO1xufTtcblxuU3ByaXRlLnByb3RvdHlwZS51cGRhdGVGaWx0ZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgJCh0aGlzLm1lc2gpLmNzcygnb3BhY2l0eScsIDEgLSB0aGlzLmZpbHRlcnMuZ2hvc3QgLyAxMDApO1xuICAgICQodGhpcy5tZXNoKS5jc3MoXG4gICAgICAgICctd2Via2l0LWZpbHRlcicsXG4gICAgICAgICdodWUtcm90YXRlKCcgKyAodGhpcy5maWx0ZXJzLmNvbG9yICogMS44KSArICdkZWcpICcgK1xuICAgICAgICAnYnJpZ2h0bmVzcygnICsgKHRoaXMuZmlsdGVycy5icmlnaHRuZXNzIDwgMCA/IHRoaXMuZmlsdGVycy5icmlnaHRuZXNzIC8gMTAwICsgMSA6IE1hdGgubWluKDIuNSwgdGhpcy5maWx0ZXJzLmJyaWdodG5lc3MgKiAuMDE1ICsgMSkpICsgJyknXG4gICAgKTtcbn07XG5cblNwcml0ZS5wcm90b3R5cGUuZ2V0VGFsa0J1YmJsZVhZID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHRleHR1cmUgPSB0aGlzLnRleHR1cmVzW3RoaXMuY3VycmVudENvc3R1bWVJbmRleF07XG4gICAgdmFyIGRyYXdXaWR0aCA9IHRleHR1cmUud2lkdGggKiB0aGlzLnNjYWxlO1xuICAgIHZhciBkcmF3SGVpZ2h0ID0gdGV4dHVyZS5oZWlnaHQgKiB0aGlzLnNjYWxlO1xuICAgIHZhciByb3RhdGlvbkNlbnRlclggPSB0aGlzLmNvc3R1bWVzW3RoaXMuY3VycmVudENvc3R1bWVJbmRleF0ucm90YXRpb25DZW50ZXJYO1xuICAgIHZhciByb3RhdGlvbkNlbnRlclkgPSB0aGlzLmNvc3R1bWVzW3RoaXMuY3VycmVudENvc3R1bWVJbmRleF0ucm90YXRpb25DZW50ZXJZO1xuICAgIHZhciBkcmF3WCA9IHRoaXMuc2NyYXRjaFggKyAoNDgwIC8gMikgLSByb3RhdGlvbkNlbnRlclg7XG4gICAgdmFyIGRyYXdZID0gLXRoaXMuc2NyYXRjaFkgKyAoMzYwIC8gMikgLSByb3RhdGlvbkNlbnRlclk7XG4gICAgcmV0dXJuIFtkcmF3WCArIGRyYXdXaWR0aCwgZHJhd1kgLSBkcmF3SGVpZ2h0IC8gMl07XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLnNob3dCdWJibGUgPSBmdW5jdGlvbih0ZXh0LCB0eXBlKSB7XG4gICAgdmFyIHh5ID0gdGhpcy5nZXRUYWxrQnViYmxlWFkoKTtcblxuICAgIHRoaXMudGFsa0J1YmJsZU9uID0gdHJ1ZTtcbiAgICB0aGlzLnRhbGtCdWJibGUuY3NzKCd6LWluZGV4JywgdGhpcy56KTtcbiAgICB0aGlzLnRhbGtCdWJibGUuY3NzKCdsZWZ0JywgeHlbMF0gKyAncHgnKTtcbiAgICB0aGlzLnRhbGtCdWJibGUuY3NzKCd0b3AnLCB4eVsxXSArICdweCcpO1xuXG4gICAgdGhpcy50YWxrQnViYmxlQm94LnJlbW92ZUNsYXNzKCdzYXktdGhpbmstYm9yZGVyJyk7XG4gICAgdGhpcy50YWxrQnViYmxlQm94LnJlbW92ZUNsYXNzKCdhc2stYm9yZGVyJyk7XG5cbiAgICB0aGlzLnRhbGtCdWJibGVTdHlsZXIucmVtb3ZlQ2xhc3MoJ2J1YmJsZS1zYXknKTtcbiAgICB0aGlzLnRhbGtCdWJibGVTdHlsZXIucmVtb3ZlQ2xhc3MoJ2J1YmJsZS10aGluaycpO1xuICAgIHRoaXMudGFsa0J1YmJsZVN0eWxlci5yZW1vdmVDbGFzcygnYnViYmxlLWFzaycpO1xuICAgIGlmICh0eXBlID09ICdzYXknKSB7XG4gICAgICAgIHRoaXMudGFsa0J1YmJsZUJveC5hZGRDbGFzcygnc2F5LXRoaW5rLWJvcmRlcicpO1xuICAgICAgICB0aGlzLnRhbGtCdWJibGVTdHlsZXIuYWRkQ2xhc3MoJ2J1YmJsZS1zYXknKTtcbiAgICB9IGVsc2UgaWYgKHR5cGUgPT0gJ3RoaW5rJykge1xuICAgICAgICB0aGlzLnRhbGtCdWJibGVCb3guYWRkQ2xhc3MoJ3NheS10aGluay1ib3JkZXInKTtcbiAgICAgICAgdGhpcy50YWxrQnViYmxlU3R5bGVyLmFkZENsYXNzKCdidWJibGUtdGhpbmsnKTtcbiAgICB9IGVsc2UgaWYgKHR5cGUgPT0gJ2RvQXNrJykge1xuICAgICAgICB0aGlzLnRhbGtCdWJibGVCb3guYWRkQ2xhc3MoJ2Fzay1ib3JkZXInKTtcbiAgICAgICAgdGhpcy50YWxrQnViYmxlU3R5bGVyLmFkZENsYXNzKCdidWJibGUtYXNrJyk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMudmlzaWJsZSkge1xuICAgICAgICB0aGlzLnRhbGtCdWJibGUuY3NzKCdkaXNwbGF5JywgJ2lubGluZS1ibG9jaycpO1xuICAgIH1cbiAgICB0aGlzLnRhbGtCdWJibGVCb3guaHRtbCh0ZXh0KTtcbn07XG5cblNwcml0ZS5wcm90b3R5cGUuaGlkZUJ1YmJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGFsa0J1YmJsZU9uID0gZmFsc2U7XG4gICAgdGhpcy50YWxrQnViYmxlLmNzcygnZGlzcGxheScsICdub25lJyk7XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLnNob3dBc2sgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmFza0lucHV0T24gPSB0cnVlO1xuICAgIHRoaXMuYXNrSW5wdXQuY3NzKCd6LWluZGV4JywgdGhpcy56KTtcbiAgICB0aGlzLmFza0lucHV0LmNzcygnbGVmdCcsICcxNXB4Jyk7XG4gICAgdGhpcy5hc2tJbnB1dC5jc3MoJ3JpZ2h0JywgJzE1cHgnKTtcbiAgICB0aGlzLmFza0lucHV0LmNzcygnYm90dG9tJywgJzdweCcpO1xuICAgIHRoaXMuYXNrSW5wdXQuY3NzKCdoZWlnaHQnLCAnMjVweCcpO1xuXG4gICAgaWYgKHRoaXMudmlzaWJsZSkge1xuICAgICAgICB0aGlzLmFza0lucHV0LmNzcygnZGlzcGxheScsICdpbmxpbmUtYmxvY2snKTtcbiAgICAgICAgdGhpcy5hc2tJbnB1dFRleHRGaWVsZC5mb2N1cygpO1xuICAgIH1cbn07XG5cblNwcml0ZS5wcm90b3R5cGUuaGlkZUFzayA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYXNrSW5wdXRPbiA9IGZhbHNlO1xuICAgIHRoaXMuYXNrSW5wdXRUZXh0RmllbGQudmFsKCcnKTtcbiAgICB0aGlzLmFza0lucHV0LmNzcygnZGlzcGxheScsICdub25lJyk7XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLmJpbmREb0Fza0J1dHRvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLmFza0lucHV0QnV0dG9uLm9uKFwia2V5cHJlc3MgY2xpY2tcIiwgZnVuY3Rpb24oZSkge1xuICAgICAgICB2YXIgZVR5cGUgPSBlLnR5cGU7XG4gICAgICAgIGlmIChlVHlwZSA9PT0gJ2NsaWNrJyB8fCAoZVR5cGUgPT09ICdrZXlwcmVzcycgJiYgZS53aGljaCA9PT0gMTMpKSB7XG4gICAgICAgICAgICB2YXIgc3RhZ2UgPSBpbnRlcnAudGFyZ2V0U3RhZ2UoKTtcbiAgICAgICAgICAgIHN0YWdlLmFza0Fuc3dlciA9ICQoc2VsZi5hc2tJbnB1dFRleHRGaWVsZCkudmFsKCk7XG4gICAgICAgICAgICBzZWxmLmhpZGVCdWJibGUoKTtcbiAgICAgICAgICAgIHNlbGYuaGlkZUFzaygpO1xuICAgICAgICAgICAgaW50ZXJwLmFjdGl2ZVRocmVhZC5wYXVzZWQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgIH0pO1xufTtcblxuU3ByaXRlLnByb3RvdHlwZS5zZXRYWSA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgICB0aGlzLnNjcmF0Y2hYID0geDtcbiAgICB0aGlzLnNjcmF0Y2hZID0geTtcbiAgICB0aGlzLnVwZGF0ZVRyYW5zZm9ybSgpO1xufTtcblxuU3ByaXRlLnByb3RvdHlwZS5zZXREaXJlY3Rpb24gPSBmdW5jdGlvbihkKSB7XG4gICAgdmFyIHJvdGF0aW9uO1xuICAgIGQgPSBkICUgMzYwXG4gICAgaWYgKGQgPCAwKSBkICs9IDM2MDtcbiAgICB0aGlzLmRpcmVjdGlvbiA9IGQgPiAxODAgPyBkIC0gMzYwIDogZDtcbiAgICBpZiAodGhpcy5yb3RhdGlvblN0eWxlID09ICdub3JtYWwnKSB7XG4gICAgICAgIHJvdGF0aW9uID0gKHRoaXMuZGlyZWN0aW9uIC0gOTApICUgMzYwO1xuICAgIH0gZWxzZSBpZiAodGhpcy5yb3RhdGlvblN0eWxlID09ICdsZWZ0UmlnaHQnKSB7XG4gICAgICAgIGlmICgoKHRoaXMuZGlyZWN0aW9uIC0gOTApICUgMzYwKSA+PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmlzRmxpcHBlZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5pc0ZsaXBwZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJvdGF0aW9uID0gMDtcbiAgICB9IGVsc2Uge1xuICAgICAgICByb3RhdGlvbiA9IDA7XG4gICAgfVxuICAgIHRoaXMucm90YXRpb24gPSByb3RhdGlvbjtcbiAgICB0aGlzLnVwZGF0ZVRyYW5zZm9ybSgpO1xufTtcblxuU3ByaXRlLnByb3RvdHlwZS5zZXRSb3RhdGlvblN0eWxlID0gZnVuY3Rpb24ocikge1xuICAgIHRoaXMucm90YXRpb25TdHlsZSA9IHI7XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLmdldFNpemUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5zY2FsZSAqIDEwMDtcbn07XG5cblNwcml0ZS5wcm90b3R5cGUuc2V0U2l6ZSA9IGZ1bmN0aW9uKHBlcmNlbnQpIHtcbiAgICB2YXIgbmV3U2NhbGUgPSBwZXJjZW50IC8gMTAwLjA7XG4gICAgbmV3U2NhbGUgPSBNYXRoLm1heCgwLjA1LCBNYXRoLm1pbihuZXdTY2FsZSwgMTAwKSk7XG4gICAgdGhpcy5zY2FsZSA9IG5ld1NjYWxlO1xuICAgIHRoaXMudXBkYXRlVHJhbnNmb3JtKCk7XG59O1xuXG4vLyBNb3ZlIGZ1bmN0aW9uc1xuU3ByaXRlLnByb3RvdHlwZS5rZWVwT25TdGFnZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB4ID0gdGhpcy5zY3JhdGNoWCArIDI0MDtcbiAgICB2YXIgeSA9IDE4MCAtIHRoaXMuc2NyYXRjaFk7XG4gICAgdmFyIG15Qm94ID0gdGhpcy5nZXRSZWN0KCk7XG4gICAgdmFyIGluc2V0ID0gLU1hdGgubWluKDE4LCBNYXRoLm1pbihteUJveC53aWR0aCwgbXlCb3guaGVpZ2h0KSAvIDIpO1xuICAgIHZhciBlZGdlQm94ID0gbmV3IFJlY3RhbmdsZShpbnNldCwgaW5zZXQsIDQ4MCAtICgyICogaW5zZXQpLCAzNjAgLSAoMiAqIGluc2V0KSk7XG4gICAgaWYgKG15Qm94LmludGVyc2VjdHMoZWRnZUJveCkpIHJldHVybjsgLy8gc3ByaXRlIGlzIHN1ZmZpY2llbnRseSBvbiBzdGFnZVxuICAgIGlmIChteUJveC5yaWdodCA8IGVkZ2VCb3gubGVmdCkgeCArPSBlZGdlQm94LmxlZnQgLSBteUJveC5yaWdodDtcbiAgICBpZiAobXlCb3gubGVmdCA+IGVkZ2VCb3gucmlnaHQpIHggLT0gbXlCb3gubGVmdCAtIGVkZ2VCb3gucmlnaHQ7XG4gICAgaWYgKG15Qm94LmJvdHRvbSA8IGVkZ2VCb3gudG9wKSB5ICs9IGVkZ2VCb3gudG9wIC0gbXlCb3guYm90dG9tO1xuICAgIGlmIChteUJveC50b3AgPiBlZGdlQm94LmJvdHRvbSkgeSAtPSBteUJveC50b3AgLSBlZGdlQm94LmJvdHRvbTtcbiAgICB0aGlzLnNjcmF0Y2hYID0geCAtIDI0MDtcbiAgICB0aGlzLnNjcmF0Y2hZID0gMTgwIC0geTtcbn07XG5cblNwcml0ZS5wcm90b3R5cGUuZ2V0UmVjdCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjSW1nID0gdGhpcy50ZXh0dXJlc1t0aGlzLmN1cnJlbnRDb3N0dW1lSW5kZXhdO1xuICAgIHZhciB4ID0gdGhpcy5zY3JhdGNoWCArIDI0MCAtIChjSW1nLndpZHRoLzIuMCk7XG4gICAgdmFyIHkgPSAxODAgLSB0aGlzLnNjcmF0Y2hZIC0gKGNJbWcuaGVpZ2h0LzIuMCk7XG4gICAgdmFyIG15Qm94ID0gbmV3IFJlY3RhbmdsZSh4LCB5LCBjSW1nLndpZHRoLCBjSW1nLmhlaWdodCk7XG4gICAgcmV0dXJuIG15Qm94O1xufTtcblxuLy8gUGVuIGZ1bmN0aW9uc1xuU3ByaXRlLnByb3RvdHlwZS5zZXRQZW5Db2xvciA9IGZ1bmN0aW9uKGMpIHtcbiAgICB2YXIgaHN2ID0gQ29sb3IucmdiMmhzdihjKTtcbiAgICB0aGlzLnBlbkh1ZSA9ICgyMDAgKiBoc3ZbMF0pIC8gMzYwIDtcbiAgICB0aGlzLnBlblNoYWRlID0gNTAgKiBoc3ZbMl07ICAvLyBub3QgcXVpdGUgcmlnaHQ7IGRvZXNuJ3QgYWNjb3VudCBmb3Igc2F0dXJhdGlvblxuICAgIHRoaXMucGVuQ29sb3JDYWNoZSA9IGM7XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLnNldFBlbkh1ZSA9IGZ1bmN0aW9uKG4pIHtcbiAgICB0aGlzLnBlbkh1ZSA9IG4gJSAyMDA7XG4gICAgaWYgKHRoaXMucGVuSHVlIDwgMCkgdGhpcy5wZW5IdWUgKz0gMjAwO1xuICAgIHRoaXMudXBkYXRlQ2FjaGVkUGVuQ29sb3IoKTtcbn07XG5cblNwcml0ZS5wcm90b3R5cGUuc2V0UGVuU2hhZGUgPSBmdW5jdGlvbihuKSB7XG4gICAgdGhpcy5wZW5TaGFkZSA9IG4gJSAyMDA7XG4gICAgaWYgKHRoaXMucGVuU2hhZGUgPCAwKSB0aGlzLnBlblNoYWRlICs9IDIwMDtcbiAgICB0aGlzLnVwZGF0ZUNhY2hlZFBlbkNvbG9yKCk7XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLnVwZGF0ZUNhY2hlZFBlbkNvbG9yID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGMgPSBDb2xvci5mcm9tSFNWKCh0aGlzLnBlbkh1ZSAqIDE4MC4wKSAvIDEwMC4wLCAxLCAxKTtcbiAgICB2YXIgc2hhZGUgPSB0aGlzLnBlblNoYWRlID4gMTAwID8gMjAwIC0gdGhpcy5wZW5TaGFkZSA6IHRoaXMucGVuU2hhZGU7IC8vIHJhbmdlIDAuLjEwMFxuICAgIGlmIChzaGFkZSA8IDUwKSB7XG4gICAgICAgIHRoaXMucGVuQ29sb3JDYWNoZSA9IENvbG9yLm1peFJHQigwLCBjLCAoMTAgKyBzaGFkZSkgLyA2MC4wKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBlbkNvbG9yQ2FjaGUgPSBDb2xvci5taXhSR0IoYywgMHhGRkZGRkYsIChzaGFkZSAtIDUwKSAvIDYwKTtcbiAgICB9XG59O1xuXG5TcHJpdGUucHJvdG90eXBlLnN0YW1wID0gZnVuY3Rpb24oY2FudmFzLCBvcGFjaXR5KSB7XG4gICAgdmFyIGRyYXdXaWR0aCA9IHRoaXMudGV4dHVyZXNbdGhpcy5jdXJyZW50Q29zdHVtZUluZGV4XS53aWR0aCAqIHRoaXMuc2NhbGU7XG4gICAgdmFyIGRyYXdIZWlnaHQgPSB0aGlzLnRleHR1cmVzW3RoaXMuY3VycmVudENvc3R1bWVJbmRleF0uaGVpZ2h0ICogdGhpcy5zY2FsZTtcbiAgICB2YXIgZHJhd1ggPSB0aGlzLnNjcmF0Y2hYICsgKDQ4MCAvIDIpO1xuICAgIHZhciBkcmF3WSA9IC10aGlzLnNjcmF0Y2hZICsgKDM2MCAvIDIpO1xuICAgIGNhbnZhcy5nbG9iYWxBbHBoYSA9IG9wYWNpdHkgLyAxMDAuMDtcbiAgICBjYW52YXMuc2F2ZSgpO1xuICAgIGNhbnZhcy50cmFuc2xhdGUoZHJhd1gsIGRyYXdZKTtcbiAgICBjYW52YXMucm90YXRlKHRoaXMucm90YXRpb24gKiBNYXRoLlBJIC8gMTgwLjApO1xuICAgIGNhbnZhcy5kcmF3SW1hZ2UodGhpcy5tZXNoLCAtZHJhd1dpZHRoLzIsIC1kcmF3SGVpZ2h0LzIsIGRyYXdXaWR0aCwgZHJhd0hlaWdodCk7XG4gICAgY2FudmFzLnJlc3RvcmUoKTtcbiAgICBjYW52YXMuZ2xvYmFsQWxwaGEgPSAxO1xufTtcblxuU3ByaXRlLnByb3RvdHlwZS5zb3VuZE5hbWVkID0gZnVuY3Rpb24obmFtZSkge1xuICAgIGlmIChuYW1lIGluIHRoaXMuc291bmRzICYmIHRoaXMuc291bmRzW25hbWVdLmJ1ZmZlcikge1xuICAgICAgICByZXR1cm4gdGhpcy5zb3VuZHNbbmFtZV07XG4gICAgfSBlbHNlIGlmIChuYW1lIGluIHJ1bnRpbWUuc3RhZ2Uuc291bmRzICYmIHJ1bnRpbWUuc3RhZ2Uuc291bmRzW25hbWVdLmJ1ZmZlcikge1xuICAgICAgICByZXR1cm4gcnVudGltZS5zdGFnZS5zb3VuZHNbbmFtZV07XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xufTtcblxuU3ByaXRlLnByb3RvdHlwZS5yZXNldEZpbHRlcnMgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbHRlcnMgPSB7XG4gICAgICAgIGNvbG9yOiAwLFxuICAgICAgICBmaXNoZXllOiAwLFxuICAgICAgICB3aGlybDogMCxcbiAgICAgICAgcGl4ZWxhdGU6IDAsXG4gICAgICAgIG1vc2FpYzogMCxcbiAgICAgICAgYnJpZ2h0bmVzczogMCxcbiAgICAgICAgZ2hvc3Q6IDBcbiAgICB9O1xuICAgIHRoaXMudXBkYXRlRmlsdGVycygpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTcHJpdGU7XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDIwMTMgTWFzc2FjaHVzZXR0cyBJbnN0aXR1dGUgb2YgVGVjaG5vbG9neVxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOyB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3Jcbi8vIG1vZGlmeSBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIHZlcnNpb24gMixcbi8vIGFzIHB1Ymxpc2hlZCBieSB0aGUgRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uLlxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuLy8gYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2Zcbi8vIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbi8vIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGZvciBtb3JlIGRldGFpbHMuXG4vL1xuLy8gWW91IHNob3VsZCBoYXZlIHJlY2VpdmVkIGEgY29weSBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2Vcbi8vIGFsb25nIHdpdGggdGhpcyBwcm9ncmFtOyBpZiBub3QsIHdyaXRlIHRvIHRoZSBGcmVlIFNvZnR3YXJlXG4vLyBGb3VuZGF0aW9uLCBJbmMuLCA1MSBGcmFua2xpbiBTdHJlZXQsIEZpZnRoIEZsb29yLCBCb3N0b24sIE1BICAwMjExMC0xMzAxLCBVU0EuXG5cbi8vIFNjcmF0Y2ggSFRNTDUgUGxheWVyXG4vLyBTdGFnZS5qc1xuLy8gVGltIE1pY2tlbCwgSnVseSAyMDExIC0gTWFyY2ggMjAxMlxuXG4vLyBQcm92aWRlcyB0aGUgYmFzaWMgbG9naWMgZm9yIHRoZSBTdGFnZSwgYSBzcGVjaWFsIGtpbmQgb2YgU3ByaXRlLlxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBTcHJpdGUgPSByZXF1aXJlKCcuL1Nwcml0ZScpO1xuXG52YXIgU3RhZ2UgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgLy8gUGxhY2UgdGhlIGJhY2tncm91bmQgbGF5ZXIgaW4gdGhlIHZlcnkgYmFjay5cbiAgICAvLyBUaGUgcGVuIGxheWVyIGlzIHJpZ2h0IGFib3ZlIHRoZSBzdGFnZSBiYWNrZ3JvdW5kLFxuICAgIC8vIGFuZCBhbGwgc3ByaXRlcyBhcmUgYWJvdmUgdGhhdC5cbiAgICB0aGlzLnogPSAtMjtcblxuICAgIC8vIFBlbiBsYXllciBhbmQgY2FudmFzIGNhY2hlLlxuICAgIHRoaXMucGVuTGF5ZXJMb2FkZWQgPSBmYWxzZTtcbiAgICB0aGlzLmxpbmVDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICB0aGlzLmxpbmVDYW52YXMud2lkdGggPSA0ODA7XG4gICAgdGhpcy5saW5lQ2FudmFzLmhlaWdodCA9IDM2MDtcbiAgICB0aGlzLmxpbmVDYWNoZSA9IHRoaXMubGluZUNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIHRoaXMuaXNTdGFnZSA9IHRydWU7XG4gICAgdGhpcy5hc2tBbnN3ZXIgPSBcIlwiOyAvL3RoaXMgaXMgYSBwcml2YXRlIHZhcmlhYmxlIGFuZCBzaG91bGQgYmUgYmxhbmtcblxuICAgIFNwcml0ZS5jYWxsKHRoaXMsIGRhdGEpO1xufTtcblxuU3RhZ2UucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShTcHJpdGUucHJvdG90eXBlKTtcblN0YWdlLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IFN0YWdlO1xuXG5TdGFnZS5wcm90b3R5cGUuYXR0YWNoUGVuTGF5ZXIgPSBmdW5jdGlvbihzY2VuZSkge1xuICAgIGlmICh0aGlzLnBlbkxheWVyTG9hZGVkKSByZXR1cm47XG4gICAgdGhpcy5wZW5MYXllckxvYWRlZCA9IHRydWU7XG4gICAgJCh0aGlzLmxpbmVDYW52YXMpLmNzcygncG9zaXRpb24nLCAnYWJzb2x1dGUnKTtcbiAgICAkKHRoaXMubGluZUNhbnZhcykuY3NzKCd6LWluZGV4JywgJy0xJyk7XG4gICAgc2NlbmUuYXBwZW5kKHRoaXMubGluZUNhbnZhcyk7XG59O1xuXG5TdGFnZS5wcm90b3R5cGUuaXNMb2FkZWQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5wZW5MYXllckxvYWRlZCAmJiB0aGlzLmNvc3R1bWVzTG9hZGVkID09IHRoaXMuY29zdHVtZXMubGVuZ3RoICYmIHRoaXMuc291bmRzTG9hZGVkID09IE9iamVjdC5rZXlzKHRoaXMuc291bmRzKS5sZW5ndGg7XG59O1xuXG4vLyBQZW4gZnVuY3Rpb25zXG5TdGFnZS5wcm90b3R5cGUuY2xlYXJQZW5TdHJva2VzID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5saW5lQ2FjaGUuY2xlYXJSZWN0KDAsIDAsIDQ4MCwgMzYwKTtcbn07XG5cblN0YWdlLnByb3RvdHlwZS5zdHJva2UgPSBmdW5jdGlvbihmcm9tLCB0bywgd2lkdGgsIGNvbG9yKSB7XG4gICAgdGhpcy5saW5lQ2FjaGUubGluZVdpZHRoID0gd2lkdGg7XG4gICAgdGhpcy5saW5lQ2FjaGUubGluZUNhcCA9ICdyb3VuZCc7XG4gICAgdGhpcy5saW5lQ2FjaGUuYmVnaW5QYXRoKCk7XG4gICAgLy8gVXNlIC41IG9mZnNldHMgZm9yIGNhbnZhcyByaWdpZCBwaXhlbCBkcmF3aW5nXG4gICAgdGhpcy5saW5lQ2FjaGUubW92ZVRvKGZyb21bMF0gKyAyNDAuNSwgMTgwLjUgLSBmcm9tWzFdKTtcbiAgICB0aGlzLmxpbmVDYWNoZS5saW5lVG8odG9bMF0gKyAyNDAuNSwgMTgwLjUgLSB0b1sxXSk7XG4gICAgdGhpcy5saW5lQ2FjaGUuc3Ryb2tlU3R5bGUgPSAncmdiKCcgKyAoY29sb3IgPj4gMTYpICsgJywnICsgKGNvbG9yID4+IDggJiAyNTUpICsgJywnICsgKGNvbG9yICYgMjU1KSArICcpJztcbiAgICB0aGlzLmxpbmVDYWNoZS5zdHJva2UoKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU3RhZ2U7XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDIwMTMgTWFzc2FjaHVzZXR0cyBJbnN0aXR1dGUgb2YgVGVjaG5vbG9neVxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOyB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3Jcbi8vIG1vZGlmeSBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIHZlcnNpb24gMixcbi8vIGFzIHB1Ymxpc2hlZCBieSB0aGUgRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uLlxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuLy8gYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2Zcbi8vIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbi8vIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGZvciBtb3JlIGRldGFpbHMuXG4vL1xuLy8gWW91IHNob3VsZCBoYXZlIHJlY2VpdmVkIGEgY29weSBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2Vcbi8vIGFsb25nIHdpdGggdGhpcyBwcm9ncmFtOyBpZiBub3QsIHdyaXRlIHRvIHRoZSBGcmVlIFNvZnR3YXJlXG4vLyBGb3VuZGF0aW9uLCBJbmMuLCA1MSBGcmFua2xpbiBTdHJlZXQsIEZpZnRoIEZsb29yLCBCb3N0b24sIE1BICAwMjExMC0xMzAxLCBVU0EuXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIExvb2tzUHJpbXMgPSBmdW5jdGlvbigpIHt9O1xuXG5Mb29rc1ByaW1zLnByb3RvdHlwZS5hZGRQcmltc1RvID0gZnVuY3Rpb24ocHJpbVRhYmxlKSB7XG4gICAgcHJpbVRhYmxlWydzaG93J10gICAgICAgICAgICAgICA9IHRoaXMucHJpbVNob3c7XG4gICAgcHJpbVRhYmxlWydoaWRlJ10gICAgICAgICAgICAgICA9IHRoaXMucHJpbUhpZGU7XG5cbiAgICBwcmltVGFibGVbJ25leHRDb3N0dW1lJ10gICAgICAgID0gdGhpcy5wcmltTmV4dENvc3R1bWU7XG4gICAgcHJpbVRhYmxlWydsb29rTGlrZTonXSAgICAgICAgICA9IHRoaXMucHJpbVNob3dDb3N0dW1lO1xuICAgIHByaW1UYWJsZVsnY29zdHVtZUluZGV4J10gICAgICAgPSB0aGlzLnByaW1Db3N0dW1lTnVtO1xuXG4gICAgcHJpbVRhYmxlWyduZXh0U2NlbmUnXSAgICAgPSB0aGlzLnByaW1OZXh0Q29zdHVtZTtcbiAgICBwcmltVGFibGVbJ3Nob3dCYWNrZ3JvdW5kOiddICAgID0gdGhpcy5wcmltU2hvd0Nvc3R1bWU7XG4gICAgcHJpbVRhYmxlWydiYWNrZ3JvdW5kSW5kZXgnXSAgICA9IHRoaXMucHJpbUNvc3R1bWVOdW07XG5cbiAgICBwcmltVGFibGVbJ3N0YXJ0U2NlbmUnXSAgICAgICAgID0gdGhpcy5wcmltU3RhcnRTY2VuZTtcbiAgICBwcmltVGFibGVbJ2JhY2tncm91bmRJbmRleCddICAgID0gdGhpcy5wcmltQ29zdHVtZU51bTtcblxuICAgIHByaW1UYWJsZVsnY2hhbmdlU2l6ZUJ5OiddICAgICAgPSB0aGlzLnByaW1DaGFuZ2VTaXplO1xuICAgIHByaW1UYWJsZVsnc2V0U2l6ZVRvOiddICAgICAgICAgPSB0aGlzLnByaW1TZXRTaXplO1xuICAgIHByaW1UYWJsZVsnc2NhbGUnXSAgICAgICAgICAgICAgPSB0aGlzLnByaW1TaXplO1xuXG4gICAgcHJpbVRhYmxlWydjb21lVG9Gcm9udCddICAgICAgICA9IHRoaXMucHJpbUdvRnJvbnQ7XG4gICAgcHJpbVRhYmxlWydnb0JhY2tCeUxheWVyczonXSAgICA9IHRoaXMucHJpbUdvQmFjaztcblxuICAgIHByaW1UYWJsZVsnY2hhbmdlR3JhcGhpY0VmZmVjdDpieTonXSA9IHRoaXMucHJpbUNoYW5nZUVmZmVjdDtcbiAgICBwcmltVGFibGVbJ3NldEdyYXBoaWNFZmZlY3Q6dG86J10gICAgPSB0aGlzLnByaW1TZXRFZmZlY3Q7XG4gICAgcHJpbVRhYmxlWydmaWx0ZXJSZXNldCddICAgICAgICAgICAgID0gdGhpcy5wcmltQ2xlYXJFZmZlY3RzO1xuXG4gICAgcHJpbVRhYmxlWydzYXk6J10gPSBmdW5jdGlvbihiKSB7IHNob3dCdWJibGUoYiwgJ3NheScpOyB9O1xuICAgIHByaW1UYWJsZVsnc2F5OmR1cmF0aW9uOmVsYXBzZWQ6ZnJvbTonXSA9IGZ1bmN0aW9uKGIpIHsgc2hvd0J1YmJsZUFuZFdhaXQoYiwgJ3NheScpOyB9O1xuICAgIHByaW1UYWJsZVsndGhpbms6J10gPSBmdW5jdGlvbihiKSB7IHNob3dCdWJibGUoYiwgJ3RoaW5rJyk7IH07XG4gICAgcHJpbVRhYmxlWyd0aGluazpkdXJhdGlvbjplbGFwc2VkOmZyb206J10gPSBmdW5jdGlvbihiKSB7IHNob3dCdWJibGVBbmRXYWl0KGIsICd0aGluaycpOyB9O1xufTtcblxuTG9va3NQcmltcy5wcm90b3R5cGUucHJpbVNob3cgPSBmdW5jdGlvbihiKSB7XG4gICAgaW50ZXJwLnRhcmdldFNwcml0ZSgpLnNldFZpc2libGUodHJ1ZSk7XG4gICAgaW50ZXJwLnJlZHJhdygpO1xufTtcblxuTG9va3NQcmltcy5wcm90b3R5cGUucHJpbUhpZGUgPSBmdW5jdGlvbihiKSB7XG4gICAgaW50ZXJwLnRhcmdldFNwcml0ZSgpLnNldFZpc2libGUoZmFsc2UpO1xuICAgIGludGVycC5yZWRyYXcoKTtcbn07XG5cbkxvb2tzUHJpbXMucHJvdG90eXBlLnByaW1OZXh0Q29zdHVtZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICBpbnRlcnAudGFyZ2V0U3ByaXRlKCkuc2hvd0Nvc3R1bWUoaW50ZXJwLnRhcmdldFNwcml0ZSgpLmN1cnJlbnRDb3N0dW1lSW5kZXggKyAxKTtcbiAgICBpbnRlcnAucmVkcmF3KCk7XG59O1xuXG5Mb29rc1ByaW1zLnByb3RvdHlwZS5wcmltU2hvd0Nvc3R1bWUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgPT0gbnVsbCkgcmV0dXJuO1xuICAgIHZhciBhcmcgPSBpbnRlcnAuYXJnKGIsIDApO1xuICAgIGlmICh0eXBlb2YoYXJnKSA9PSAnbnVtYmVyJykge1xuICAgICAgICBzLnNob3dDb3N0dW1lKGFyZyAtIDEpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICgoYXJnID09ICdDQU1FUkEnKSB8fCAoYXJnID09ICdDQU1FUkEgLSBNSVJST1InKSkge1xuICAgICAgICAgICAgcy5zaG93Q29zdHVtZU5hbWVkKGFyZyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGkgPSBzLmluZGV4T2ZDb3N0dW1lTmFtZWQoYXJnKTtcbiAgICAgICAgaWYgKGkgPj0gMCkge1xuICAgICAgICAgICAgcy5zaG93Q29zdHVtZShpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciBuID0gcGFyc2VJbnQoYXJnLCAxMCk7XG4gICAgICAgICAgICBpZiAobiA9PT0gbikgeyAvLyBpZiBuIGlzIG5vdCBOYU5cbiAgICAgICAgICAgICAgICBzLnNob3dDb3N0dW1lKG4gLSAxKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuOyAgLy8gYXJnIGRpZCBub3QgbWF0Y2ggYSBjb3N0dW1lIG5hbWUgbm9yIGlzIGEgdmFsaWQgbnVtYmVyXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKHMudmlzaWJsZSkgaW50ZXJwLnJlZHJhdygpO1xufTtcblxuTG9va3NQcmltcy5wcm90b3R5cGUucHJpbVN0YXJ0U2NlbmUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBydW50aW1lLnN0YWdlO1xuICAgIHZhciBhcmcgPSBpbnRlcnAuYXJnKGIsIDApO1xuICAgIGlmICh0eXBlb2YoYXJnKSA9PSAnbnVtYmVyJykge1xuICAgICAgICBzLnNob3dDb3N0dW1lKGFyZyAtIDEpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICgoYXJnID09ICdDQU1FUkEnKSB8fCAoYXJnID09ICdDQU1FUkEgLSBNSVJST1InKSkge1xuICAgICAgICAgICAgcy5zaG93Q29zdHVtZU5hbWVkKGFyZyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGkgPSBzLmluZGV4T2ZDb3N0dW1lTmFtZWQoYXJnKTtcbiAgICAgICAgaWYgKGkgPj0gMCkge1xuICAgICAgICAgICAgcy5zaG93Q29zdHVtZShpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhciBuID0gcGFyc2VJbnQoYXJnLCAxMCk7XG4gICAgICAgICAgICBpZiAobiA9PT0gbikgeyAvLyBmYXN0ICFpc05hTiBjaGVja1xuICAgICAgICAgICAgICAgIHMuc2hvd0Nvc3R1bWUobiAtIDEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm47ICAvLyBhcmcgZGlkIG5vdCBtYXRjaCBhIGNvc3R1bWUgbmFtZSBub3IgaXMgYSB2YWxpZCBudW1iZXJcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBpZiAocy52aXNpYmxlKSBpbnRlcnAucmVkcmF3KCk7XG59O1xuXG5Mb29rc1ByaW1zLnByb3RvdHlwZS5wcmltQ29zdHVtZU51bSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICByZXR1cm4gcyA9PSBudWxsID8gMSA6IHMuY3VycmVudENvc3R1bWVJbmRleCArIDE7XG59O1xuXG5Mb29rc1ByaW1zLnByb3RvdHlwZS5wcmltQ2hhbmdlU2l6ZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyA9PSBudWxsKSByZXR1cm47XG4gICAgcy5zZXRTaXplKHMuZ2V0U2l6ZSgpICsgaW50ZXJwLm51bWFyZyhiLCAwKSk7XG4gICAgaWYgKHMudmlzaWJsZSkgaW50ZXJwLnJlZHJhdygpO1xufTtcblxuTG9va3NQcmltcy5wcm90b3R5cGUucHJpbVNldFNpemUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgPT0gbnVsbCkgcmV0dXJuO1xuICAgIHMuc2V0U2l6ZShpbnRlcnAubnVtYXJnKGIsIDApKTtcbiAgICBpZiAocy52aXNpYmxlKSBpbnRlcnAucmVkcmF3KCk7XG59O1xuXG5Mb29rc1ByaW1zLnByb3RvdHlwZS5wcmltU2l6ZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyA9PSBudWxsKSByZXR1cm4gMTAwO1xuICAgIHJldHVybiBzLmdldFNpemUoKTtcbn07XG5cbkxvb2tzUHJpbXMucHJvdG90eXBlLnByaW1Hb0Zyb250ID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHJ1bnRpbWUucmVhc3NpZ25aKHMsIG51bGwpO1xuICAgIGlmIChzLnZpc2libGUpIGludGVycC5yZWRyYXcoKTtcbn07XG5cbkxvb2tzUHJpbXMucHJvdG90eXBlLnByaW1Hb0JhY2sgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgcnVudGltZS5yZWFzc2lnbloocywgaW50ZXJwLm51bWFyZyhiLCAwKSk7XG4gICAgaWYocy52aXNpYmxlKSBpbnRlcnAucmVkcmF3KCk7XG59O1xuXG5Mb29rc1ByaW1zLnByb3RvdHlwZS5wcmltQ2hhbmdlRWZmZWN0ID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHMuZmlsdGVyc1tpbnRlcnAuYXJnKGIsIDApXSArPSBpbnRlcnAubnVtYXJnKGIsIDEpO1xuICAgIHMudXBkYXRlRmlsdGVycygpO1xufTtcblxuTG9va3NQcmltcy5wcm90b3R5cGUucHJpbVNldEVmZmVjdCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBzLmZpbHRlcnNbaW50ZXJwLmFyZyhiLCAwKV0gPSBpbnRlcnAubnVtYXJnKGIsIDEpO1xuICAgIHMudXBkYXRlRmlsdGVycygpO1xufTtcblxuTG9va3NQcmltcy5wcm90b3R5cGUucHJpbUNsZWFyRWZmZWN0cyA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBzLnJlc2V0RmlsdGVycygpO1xuICAgIHMudXBkYXRlRmlsdGVycygpO1xufTtcblxudmFyIHNob3dCdWJibGUgPSBmdW5jdGlvbihiLCB0eXBlKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgIT09IG51bGwpIHMuc2hvd0J1YmJsZShpbnRlcnAuYXJnKGIsIDApLCB0eXBlKTtcbn07XG5cbnZhciBzaG93QnViYmxlQW5kV2FpdCA9IGZ1bmN0aW9uKGIsIHR5cGUpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmIChpbnRlcnAuYWN0aXZlVGhyZWFkLmZpcnN0VGltZSkge1xuICAgICAgICB2YXIgdGV4dCA9IGludGVycC5hcmcoYiwgMCk7XG4gICAgICAgIHZhciBzZWNzID0gaW50ZXJwLm51bWFyZyhiLCAxKTtcbiAgICAgICAgcy5zaG93QnViYmxlKHRleHQsIHR5cGUpO1xuICAgICAgICBpZiAocy52aXNpYmxlKSBpbnRlcnAucmVkcmF3KCk7XG4gICAgICAgIGludGVycC5zdGFydFRpbWVyKHNlY3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChpbnRlcnAuY2hlY2tUaW1lcigpKSBzLmhpZGVCdWJibGUoKTtcbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IExvb2tzUHJpbXM7XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDIwMTMgTWFzc2FjaHVzZXR0cyBJbnN0aXR1dGUgb2YgVGVjaG5vbG9neVxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOyB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3Jcbi8vIG1vZGlmeSBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIHZlcnNpb24gMixcbi8vIGFzIHB1Ymxpc2hlZCBieSB0aGUgRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uLlxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuLy8gYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2Zcbi8vIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbi8vIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGZvciBtb3JlIGRldGFpbHMuXG4vL1xuLy8gWW91IHNob3VsZCBoYXZlIHJlY2VpdmVkIGEgY29weSBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2Vcbi8vIGFsb25nIHdpdGggdGhpcyBwcm9ncmFtOyBpZiBub3QsIHdyaXRlIHRvIHRoZSBGcmVlIFNvZnR3YXJlXG4vLyBGb3VuZGF0aW9uLCBJbmMuLCA1MSBGcmFua2xpbiBTdHJlZXQsIEZpZnRoIEZsb29yLCBCb3N0b24sIE1BICAwMjExMC0xMzAxLCBVU0EuXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIE1vdGlvbkFuZFBlblByaW1zID0gZnVuY3Rpb24oKSB7fTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLmFkZFByaW1zVG8gPSBmdW5jdGlvbihwcmltVGFibGUpIHtcbiAgICBwcmltVGFibGVbJ2ZvcndhcmQ6J10gICAgICAgICAgID0gdGhpcy5wcmltTW92ZTtcbiAgICBwcmltVGFibGVbJ3R1cm5MZWZ0OiddICAgICAgICAgID0gdGhpcy5wcmltVHVybkxlZnQ7XG4gICAgcHJpbVRhYmxlWyd0dXJuUmlnaHQ6J10gICAgICAgICA9IHRoaXMucHJpbVR1cm5SaWdodDtcbiAgICBwcmltVGFibGVbJ2hlYWRpbmc6J10gICAgICAgICAgID0gdGhpcy5wcmltU2V0RGlyZWN0aW9uO1xuICAgIHByaW1UYWJsZVsncG9pbnRUb3dhcmRzOiddICAgICAgPSB0aGlzLnByaW1Qb2ludFRvd2FyZHM7XG4gICAgcHJpbVRhYmxlWydnb3RvWDp5OiddICAgICAgICAgICA9IHRoaXMucHJpbUdvVG87XG4gICAgcHJpbVRhYmxlWydnb3RvU3ByaXRlT3JNb3VzZTonXSAgPSB0aGlzLnByaW1Hb1RvU3ByaXRlT3JNb3VzZTtcbiAgICBwcmltVGFibGVbJ2dsaWRlU2Vjczp0b1g6eTplbGFwc2VkOmZyb206J10gPSB0aGlzLnByaW1HbGlkZTtcblxuICAgIHByaW1UYWJsZVsnY2hhbmdlWHBvc0J5OiddICAgICAgPSB0aGlzLnByaW1DaGFuZ2VYO1xuICAgIHByaW1UYWJsZVsneHBvczonXSAgICAgICAgICAgICAgPSB0aGlzLnByaW1TZXRYO1xuICAgIHByaW1UYWJsZVsnY2hhbmdlWXBvc0J5OiddICAgICAgPSB0aGlzLnByaW1DaGFuZ2VZO1xuICAgIHByaW1UYWJsZVsneXBvczonXSAgICAgICAgICAgICAgPSB0aGlzLnByaW1TZXRZO1xuXG4gICAgcHJpbVRhYmxlWydib3VuY2VPZmZFZGdlJ10gICAgICA9IHRoaXMucHJpbUJvdW5jZU9mZkVkZ2U7XG4gICAgcHJpbVRhYmxlWydzZXRSb3RhdGlvblN0eWxlJ10gICA9IHRoaXMucHJpbVNldFJvdGF0aW9uU3R5bGU7XG5cbiAgICBwcmltVGFibGVbJ3hwb3MnXSAgICAgICAgICAgICAgID0gdGhpcy5wcmltWFBvc2l0aW9uO1xuICAgIHByaW1UYWJsZVsneXBvcyddICAgICAgICAgICAgICAgPSB0aGlzLnByaW1ZUG9zaXRpb247XG4gICAgcHJpbVRhYmxlWydoZWFkaW5nJ10gICAgICAgICAgICA9IHRoaXMucHJpbURpcmVjdGlvbjtcblxuICAgIHByaW1UYWJsZVsnY2xlYXJQZW5UcmFpbHMnXSAgICAgPSB0aGlzLnByaW1DbGVhcjtcbiAgICBwcmltVGFibGVbJ3B1dFBlbkRvd24nXSAgICAgICAgID0gdGhpcy5wcmltUGVuRG93bjtcbiAgICBwcmltVGFibGVbJ3B1dFBlblVwJ10gICAgICAgICAgID0gdGhpcy5wcmltUGVuVXA7XG4gICAgcHJpbVRhYmxlWydwZW5Db2xvcjonXSAgICAgICAgICA9IHRoaXMucHJpbVNldFBlbkNvbG9yO1xuICAgIHByaW1UYWJsZVsnc2V0UGVuSHVlVG86J10gICAgICAgPSB0aGlzLnByaW1TZXRQZW5IdWU7XG4gICAgcHJpbVRhYmxlWydjaGFuZ2VQZW5IdWVCeTonXSAgICA9IHRoaXMucHJpbUNoYW5nZVBlbkh1ZTtcbiAgICBwcmltVGFibGVbJ3NldFBlblNoYWRlVG86J10gICAgID0gdGhpcy5wcmltU2V0UGVuU2hhZGU7XG4gICAgcHJpbVRhYmxlWydjaGFuZ2VQZW5TaGFkZUJ5OiddICA9IHRoaXMucHJpbUNoYW5nZVBlblNoYWRlO1xuICAgIHByaW1UYWJsZVsncGVuU2l6ZTonXSAgICAgICAgICAgPSB0aGlzLnByaW1TZXRQZW5TaXplO1xuICAgIHByaW1UYWJsZVsnY2hhbmdlUGVuU2l6ZUJ5OiddICAgPSB0aGlzLnByaW1DaGFuZ2VQZW5TaXplO1xuXG4gICAgcHJpbVRhYmxlWydzdGFtcENvc3R1bWUnXSAgICAgICA9IHRoaXMucHJpbVN0YW1wO1xuICAgIHByaW1UYWJsZVsnc3RhbXBUcmFuc3BhcmVudCddICAgPSB0aGlzLnByaW1TdGFtcFRyYW5zcGFyZW50O1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1Nb3ZlID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHZhciByYWRpYW5zID0gKDkwIC0gcy5kaXJlY3Rpb24pICogTWF0aC5QSSAvIDE4MDtcbiAgICB2YXIgZCA9IGludGVycC5udW1hcmcoYiwgMCk7XG5cbiAgICBtb3ZlU3ByaXRlVG8ocywgcy5zY3JhdGNoWCArIGQgKiBNYXRoLmNvcyhyYWRpYW5zKSwgcy5zY3JhdGNoWSArIGQgKiBNYXRoLnNpbihyYWRpYW5zKSk7XG4gICAgaWYgKHMudmlzaWJsZSkgaW50ZXJwLnJlZHJhdygpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1UdXJuTGVmdCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICB2YXIgZCA9IHMuZGlyZWN0aW9uIC0gaW50ZXJwLm51bWFyZyhiLCAwKTtcbiAgICBzLnNldERpcmVjdGlvbihkKTtcbiAgICBpZiAocy52aXNpYmxlKSBpbnRlcnAucmVkcmF3KCk7XG59O1xuXG5Nb3Rpb25BbmRQZW5Qcmltcy5wcm90b3R5cGUucHJpbVR1cm5SaWdodCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICB2YXIgZCA9IHMuZGlyZWN0aW9uICsgaW50ZXJwLm51bWFyZyhiLCAwKTtcbiAgICBzLnNldERpcmVjdGlvbihkKTtcbiAgICBpZiAocy52aXNpYmxlKSBpbnRlcnAucmVkcmF3KCk7XG59O1xuXG5Nb3Rpb25BbmRQZW5Qcmltcy5wcm90b3R5cGUucHJpbVNldERpcmVjdGlvbiA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBzLnNldERpcmVjdGlvbihpbnRlcnAubnVtYXJnKGIsIDApKTtcbiAgICBpZiAocy52aXNpYmxlKSBpbnRlcnAucmVkcmF3KCk7XG59O1xuXG5Nb3Rpb25BbmRQZW5Qcmltcy5wcm90b3R5cGUucHJpbVBvaW50VG93YXJkcyA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICB2YXIgcCA9IG1vdXNlT3JTcHJpdGVQb3NpdGlvbihpbnRlcnAuYXJnKGIsIDApKTtcbiAgICBpZiAocyA9PSBudWxsIHx8IHAgPT0gbnVsbCkgcmV0dXJuO1xuICAgIHZhciBkeCA9IHAueCAtIHMuc2NyYXRjaFg7XG4gICAgdmFyIGR5ID0gcC55IC0gcy5zY3JhdGNoWTtcbiAgICB2YXIgYW5nbGUgPSA5MCAtIE1hdGguYXRhbjIoZHksIGR4KSAqIDE4MCAvIE1hdGguUEk7XG4gICAgcy5zZXREaXJlY3Rpb24oYW5nbGUpO1xuICAgIGlmIChzLnZpc2libGUpIGludGVycC5yZWRyYXcoKTtcbn07XG5cbk1vdGlvbkFuZFBlblByaW1zLnByb3RvdHlwZS5wcmltR29UbyA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyAhPSBudWxsKSBtb3ZlU3ByaXRlVG8ocywgaW50ZXJwLm51bWFyZyhiLCAwKSwgaW50ZXJwLm51bWFyZyhiLCAxKSk7XG59O1xuXG5Nb3Rpb25BbmRQZW5Qcmltcy5wcm90b3R5cGUucHJpbUdvVG9TcHJpdGVPck1vdXNlID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHZhciBwID0gbW91c2VPclNwcml0ZVBvc2l0aW9uKGludGVycC5hcmcoYiwgMCkpO1xuICAgIGlmIChzID09IG51bGwgfHwgcCA9PSBudWxsKSByZXR1cm47XG4gICAgbW92ZVNwcml0ZVRvKHMsIHAueCwgcC55KTtcbn07XG5cbk1vdGlvbkFuZFBlblByaW1zLnByb3RvdHlwZS5wcmltR2xpZGUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgPT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmIChpbnRlcnAuYWN0aXZlVGhyZWFkLmZpcnN0VGltZSkge1xuICAgICAgICB2YXIgc2VjcyA9IGludGVycC5udW1hcmcoYiwgMCk7XG4gICAgICAgIHZhciBkZXN0WCA9IGludGVycC5udW1hcmcoYiwgMSk7XG4gICAgICAgIHZhciBkZXN0WSA9IGludGVycC5udW1hcmcoYiwgMik7XG4gICAgICAgIGlmIChzZWNzIDw9IDApIHtcbiAgICAgICAgICAgIG1vdmVTcHJpdGVUbyhzLCBkZXN0WCwgZGVzdFkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIHJlY29yZCBzdGF0ZTogWzBdc3RhcnQgbXNlY3MsIFsxXWR1cmF0aW9uLCBbMl1zdGFydFgsIFszXXN0YXJ0WSwgWzRdZW5kWCwgWzVdZW5kWVxuICAgICAgICBpbnRlcnAuYWN0aXZlVGhyZWFkLnRtcE9iaiA9IFtpbnRlcnAuY3VycmVudE1TZWNzLCAxMDAwICogc2Vjcywgcy5zY3JhdGNoWCwgcy5zY3JhdGNoWSwgZGVzdFgsIGRlc3RZXTtcbiAgICAgICAgaW50ZXJwLnN0YXJ0VGltZXIoc2Vjcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHN0YXRlID0gaW50ZXJwLmFjdGl2ZVRocmVhZC50bXBPYmo7XG4gICAgICAgIGlmICghaW50ZXJwLmNoZWNrVGltZXIoKSkge1xuICAgICAgICAgICAgLy8gaW4gcHJvZ3Jlc3M6IG1vdmUgdG8gaW50ZXJtZWRpYXRlIHBvc2l0aW9uIGFsb25nIHBhdGhcbiAgICAgICAgICAgIHZhciBmcmFjID0gKGludGVycC5jdXJyZW50TVNlY3MgLSBzdGF0ZVswXSkgLyBzdGF0ZVsxXTtcbiAgICAgICAgICAgIHZhciBuZXdYID0gc3RhdGVbMl0gKyBmcmFjICogKHN0YXRlWzRdIC0gc3RhdGVbMl0pO1xuICAgICAgICAgICAgdmFyIG5ld1kgPSBzdGF0ZVszXSArIGZyYWMgKiAoc3RhdGVbNV0gLSBzdGF0ZVszXSk7XG4gICAgICAgICAgICBtb3ZlU3ByaXRlVG8ocywgbmV3WCwgbmV3WSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBmaW5pc2hlZDogbW92ZSB0byBmaW5hbCBwb3NpdGlvbiBhbmQgY2xlYXIgc3RhdGVcbiAgICAgICAgICAgIG1vdmVTcHJpdGVUbyhzLCBzdGF0ZVs0XSwgc3RhdGVbNV0pO1xuICAgICAgICAgICAgaW50ZXJwLmFjdGl2ZVRocmVhZC50bXBPYmogPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1DaGFuZ2VYID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzICE9IG51bGwpIG1vdmVTcHJpdGVUbyhzLCBzLnNjcmF0Y2hYICsgaW50ZXJwLm51bWFyZyhiLCAwKSwgcy5zY3JhdGNoWSk7XG59O1xuXG5Nb3Rpb25BbmRQZW5Qcmltcy5wcm90b3R5cGUucHJpbVNldFggPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgIT0gbnVsbCkgbW92ZVNwcml0ZVRvKHMsIGludGVycC5udW1hcmcoYiwgMCksIHMuc2NyYXRjaFkpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1DaGFuZ2VZID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzICE9IG51bGwpIG1vdmVTcHJpdGVUbyhzLCBzLnNjcmF0Y2hYLCBzLnNjcmF0Y2hZICsgaW50ZXJwLm51bWFyZyhiLCAwKSk7XG59O1xuXG5Nb3Rpb25BbmRQZW5Qcmltcy5wcm90b3R5cGUucHJpbVNldFkgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgIT0gbnVsbCkgbW92ZVNwcml0ZVRvKHMsIHMuc2NyYXRjaFgsIGludGVycC5udW1hcmcoYiwgMCkpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1Cb3VuY2VPZmZFZGdlID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzID09IG51bGwpIHJldHVybjtcbiAgICBpZiAoIXR1cm5Bd2F5RnJvbUVkZ2UocykpIHJldHVybjtcbiAgICBlbnN1cmVPblN0YWdlT25Cb3VuY2Uocyk7XG4gICAgaWYgKHMudmlzaWJsZSkgaW50ZXJwLnJlZHJhdygpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1TZXRSb3RhdGlvblN0eWxlID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzID09IG51bGwpIHJldHVybjtcbiAgICB2YXIgcmVxdWVzdCA9IGludGVycC5hcmcoYiwgMCk7XG4gICAgdmFyIHJvdGF0aW9uU3R5bGUgPSAnbm9ybWFsJztcbiAgICBpZiAocmVxdWVzdCA9PSAnYWxsIGFyb3VuZCcpIHJvdGF0aW9uU3R5bGUgPSAnbm9ybWFsJztcbiAgICBlbHNlIGlmIChyZXF1ZXN0ID09ICdsZWZ0LXJpZ2h0Jykgcm90YXRpb25TdHlsZSA9ICdsZWZ0UmlnaHQnO1xuICAgIGVsc2UgaWYgKHJlcXVlc3QgPT0gJ25vbmUnKSByb3RhdGlvblN0eWxlID0gJ25vbmUnO1xuICAgIHMuc2V0Um90YXRpb25TdHlsZShyb3RhdGlvblN0eWxlKTtcbn07XG5cbk1vdGlvbkFuZFBlblByaW1zLnByb3RvdHlwZS5wcmltWFBvc2l0aW9uID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHJldHVybiBzICE9IG51bGwgPyBzLnNjcmF0Y2hYIDogMDtcbn07XG5cbk1vdGlvbkFuZFBlblByaW1zLnByb3RvdHlwZS5wcmltWVBvc2l0aW9uID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHJldHVybiBzICE9IG51bGwgPyBzLnNjcmF0Y2hZIDogMDtcbn07XG5cbk1vdGlvbkFuZFBlblByaW1zLnByb3RvdHlwZS5wcmltRGlyZWN0aW9uID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHJldHVybiBzICE9IG51bGwgPyBzLmRpcmVjdGlvbiA6IDA7XG59O1xuXG5Nb3Rpb25BbmRQZW5Qcmltcy5wcm90b3R5cGUucHJpbUNsZWFyID0gZnVuY3Rpb24oYikge1xuICAgIHJ1bnRpbWUuc3RhZ2UuY2xlYXJQZW5TdHJva2VzKCk7XG4gICAgaW50ZXJwLnJlZHJhdygpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1QZW5Eb3duID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzICE9IG51bGwpIHMucGVuSXNEb3duID0gdHJ1ZTtcbiAgICBzdHJva2Uocywgcy5zY3JhdGNoWCwgcy5zY3JhdGNoWSwgcy5zY3JhdGNoWCArIDAuMiwgcy5zY3JhdGNoWSArIDAuMik7XG4gICAgaW50ZXJwLnJlZHJhdygpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1QZW5VcCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyAhPSBudWxsKSBzLnBlbklzRG93biA9IGZhbHNlO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1TZXRQZW5Db2xvciA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyAhPSBudWxsKSBzLnNldFBlbkNvbG9yKGludGVycC5udW1hcmcoYiwgMCkpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1TZXRQZW5IdWUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgIT0gbnVsbCkgcy5zZXRQZW5IdWUoaW50ZXJwLm51bWFyZyhiLCAwKSk7XG59O1xuXG5Nb3Rpb25BbmRQZW5Qcmltcy5wcm90b3R5cGUucHJpbUNoYW5nZVBlbkh1ZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyAhPSBudWxsKSBzLnNldFBlbkh1ZShzLnBlbkh1ZSArIGludGVycC5udW1hcmcoYiwgMCkpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1TZXRQZW5TaGFkZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyAhPSBudWxsKSBzLnNldFBlblNoYWRlKGludGVycC5udW1hcmcoYiwgMCkpO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1DaGFuZ2VQZW5TaGFkZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyAhPSBudWxsKSBzLnNldFBlblNoYWRlKHMucGVuU2hhZGUgKyBpbnRlcnAubnVtYXJnKGIsIDApKTtcbn07XG5cbk1vdGlvbkFuZFBlblByaW1zLnByb3RvdHlwZS5wcmltU2V0UGVuU2l6ZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICB2YXIgdyA9IE1hdGgubWF4KDAsIE1hdGgubWluKGludGVycC5udW1hcmcoYiwgMCksIDEwMCkpO1xuICAgIGlmIChzICE9IG51bGwpIHMucGVuV2lkdGggPSB3O1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1DaGFuZ2VQZW5TaXplID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHZhciB3ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ocy5wZW5XaWR0aCArIGludGVycC5udW1hcmcoYiwgMCksIDEwMCkpO1xuICAgIGlmIChzICE9IG51bGwpIHMucGVuV2lkdGggPSB3O1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1TdGFtcCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBzLnN0YW1wKHJ1bnRpbWUuc3RhZ2UubGluZUNhY2hlLCAxMDApO1xufTtcblxuTW90aW9uQW5kUGVuUHJpbXMucHJvdG90eXBlLnByaW1TdGFtcFRyYW5zcGFyZW50ID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIHZhciB0cmFuc3BhcmVuY3kgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihpbnRlcnAubnVtYXJnKGIsIDApLCAxMDApKTtcbiAgICB2YXIgYWxwaGEgPSAxMDAgLSB0cmFuc3BhcmVuY3k7XG4gICAgcy5zdGFtcChydW50aW1lLnN0YWdlLmxpbmVDYWNoZSwgYWxwaGEpO1xufTtcblxuLy8gSGVscGVyc1xudmFyIHN0cm9rZSA9IGZ1bmN0aW9uKHMsIG9sZFgsIG9sZFksIG5ld1gsIG5ld1kpIHtcbiAgICBydW50aW1lLnN0YWdlLnN0cm9rZShbb2xkWCwgb2xkWV0sIFtuZXdYLCBuZXdZXSwgcy5wZW5XaWR0aCwgcy5wZW5Db2xvckNhY2hlKTtcbiAgICBpbnRlcnAucmVkcmF3KCk7XG59O1xuXG52YXIgbW91c2VPclNwcml0ZVBvc2l0aW9uID0gZnVuY3Rpb24oYXJnKSB7XG4gICAgaWYgKGFyZyA9PSAnX21vdXNlXycpIHtcbiAgICAgICAgdmFyIHcgPSBydW50aW1lLnN0YWdlO1xuICAgICAgICByZXR1cm4gbmV3IFBvaW50KHJ1bnRpbWUubW91c2VQb3NbMF0sIHJ1bnRpbWUubW91c2VQb3NbMV0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBzID0gcnVudGltZS5zcHJpdGVOYW1lZChhcmcpO1xuICAgICAgICBpZiAocyA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIG5ldyBQb2ludChzLnNjcmF0Y2hYLCBzLnNjcmF0Y2hZKTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG59O1xuXG52YXIgbW92ZVNwcml0ZVRvID0gZnVuY3Rpb24ocywgbmV3WCwgbmV3WSkge1xuICAgIHZhciBvbGRYID0gcy5zY3JhdGNoWDtcbiAgICB2YXIgb2xkWSA9IHMuc2NyYXRjaFk7XG4gICAgcy5zZXRYWShuZXdYLCBuZXdZKTtcbiAgICBzLmtlZXBPblN0YWdlKCk7XG4gICAgaWYgKHMucGVuSXNEb3duKSBzdHJva2Uocywgb2xkWCwgb2xkWSwgcy5zY3JhdGNoWCwgcy5zY3JhdGNoWSk7XG4gICAgaWYgKHMucGVuSXNEb3duIHx8IHMudmlzaWJsZSkgaW50ZXJwLnJlZHJhdygpO1xufTtcblxudmFyIHR1cm5Bd2F5RnJvbUVkZ2UgPSBmdW5jdGlvbihzKSB7XG4gICAgLy8gdHVybiBhd2F5IGZyb20gdGhlIG5lYXJlc3QgZWRnZSBpZiBpdCdzIGNsb3NlIGVub3VnaDsgb3RoZXJ3aXNlIGRvIG5vdGhpbmdcbiAgICAvLyBOb3RlOiBjb21wYXJpc2lvbnMgYXJlIGluIHRoZSBzdGFnZSBjb29yZGluYXRlcywgd2l0aCBvcmlnaW4gKDAsIDApXG4gICAgLy8gdXNlIGJvdW5kaW5nIHJlY3Qgb2YgdGhlIHNwcml0ZSB0byBhY2NvdW50IGZvciBjb3N0dW1lIHJvdGF0aW9uIGFuZCBzY2FsZVxuICAgIHZhciByID0gcy5nZXRSZWN0KCk7XG4gICAgLy8gbWVhc3VyZSBkaXN0YW5jZSB0byBlZGdlc1xuICAgIHZhciBkMSA9IE1hdGgubWF4KDAsIHIubGVmdCk7XG4gICAgdmFyIGQyID0gTWF0aC5tYXgoMCwgci50b3ApO1xuICAgIHZhciBkMyA9IE1hdGgubWF4KDAsIDQ4MCAtIHIucmlnaHQpO1xuICAgIHZhciBkNCA9IE1hdGgubWF4KDAsIDM2MCAtIHIuYm90dG9tKTtcbiAgICAvLyBmaW5kIHRoZSBuZWFyZXN0IGVkZ2VcbiAgICB2YXIgZSA9IDAsIG1pbkRpc3QgPSAxMDAwMDA7XG4gICAgaWYgKGQxIDwgbWluRGlzdCkgeyBtaW5EaXN0ID0gZDE7IGUgPSAxOyB9XG4gICAgaWYgKGQyIDwgbWluRGlzdCkgeyBtaW5EaXN0ID0gZDI7IGUgPSAyOyB9XG4gICAgaWYgKGQzIDwgbWluRGlzdCkgeyBtaW5EaXN0ID0gZDM7IGUgPSAzOyB9XG4gICAgaWYgKGQ0IDwgbWluRGlzdCkgeyBtaW5EaXN0ID0gZDQ7IGUgPSA0OyB9XG4gICAgaWYgKG1pbkRpc3QgPiAwKSByZXR1cm4gZmFsc2U7ICAvLyBub3QgdG91Y2hpbmcgdG8gYW55IGVkZ2VcbiAgICAvLyBwb2ludCBhd2F5IGZyb20gbmVhcmVzdCBlZGdlXG4gICAgdmFyIHJhZGlhbnMgPSAoOTAgLSBzLmRpcmVjdGlvbikgKiBNYXRoLlBJIC8gMTgwO1xuICAgIHZhciBkeCA9IE1hdGguY29zKHJhZGlhbnMpO1xuICAgIHZhciBkeSA9IC1NYXRoLnNpbihyYWRpYW5zKTtcbiAgICBpZiAoZSA9PSAxKSB7IGR4ID0gTWF0aC5tYXgoMC4yLCBNYXRoLmFicyhkeCkpOyB9XG4gICAgaWYgKGUgPT0gMikgeyBkeSA9IE1hdGgubWF4KDAuMiwgTWF0aC5hYnMoZHkpKTsgfVxuICAgIGlmIChlID09IDMpIHsgZHggPSAwIC0gTWF0aC5tYXgoMC4yLCBNYXRoLmFicyhkeCkpOyB9XG4gICAgaWYgKGUgPT0gNCkgeyBkeSA9IDAgLSBNYXRoLm1heCgwLjIsIE1hdGguYWJzKGR5KSk7IH1cbiAgICB2YXIgbmV3RGlyID0gTWF0aC5hdGFuMihkeSwgZHgpICogMTgwIC8gTWF0aC5QSSArIDkwO1xuICAgIHMuZGlyZWN0aW9uID0gbmV3RGlyO1xuICAgIHJldHVybiB0cnVlO1xufTtcblxudmFyIGVuc3VyZU9uU3RhZ2VPbkJvdW5jZSA9IGZ1bmN0aW9uKHMpIHtcbiAgICB2YXIgciA9IHMuZ2V0UmVjdCgpO1xuICAgIGlmIChyLmxlZnQgPCAwKSBtb3ZlU3ByaXRlVG8ocywgcy5zY3JhdGNoWCAtIHIubGVmdCwgcy5zY3JhdGNoWSk7XG4gICAgaWYgKHIudG9wIDwgMCkgbW92ZVNwcml0ZVRvKHMsIHMuc2NyYXRjaFgsIHMuc2NyYXRjaFkgKyByLnRvcCk7XG4gICAgaWYgKHIucmlnaHQgPiA0ODApIHtcbiAgICAgICAgbW92ZVNwcml0ZVRvKHMsIHMuc2NyYXRjaFggLSAoci5yaWdodCAtIDQ4MCksIHMuc2NyYXRjaFkpO1xuICAgIH1cbiAgICBpZiAoci5ib3R0b20gPiAzNjApIHtcbiAgICAgICAgbW92ZVNwcml0ZVRvKHMsIHMuc2NyYXRjaFgsIHMuc2NyYXRjaFkgKyAoci5ib3R0b20gLSAzNjApKTtcbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdGlvbkFuZFBlblByaW1zO1xuIiwiLy8gQ29weXJpZ2h0IChDKSAyMDEzIE1hc3NhY2h1c2V0dHMgSW5zdGl0dXRlIG9mIFRlY2hub2xvZ3lcbi8vXG4vLyBUaGlzIHByb2dyYW0gaXMgZnJlZSBzb2Z0d2FyZTsgeW91IGNhbiByZWRpc3RyaWJ1dGUgaXQgYW5kL29yXG4vLyBtb2RpZnkgaXQgdW5kZXIgdGhlIHRlcm1zIG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZSB2ZXJzaW9uIDIsXG4vLyBhcyBwdWJsaXNoZWQgYnkgdGhlIEZyZWUgU29mdHdhcmUgRm91bmRhdGlvbi5cbi8vXG4vLyBUaGlzIHByb2dyYW0gaXMgZGlzdHJpYnV0ZWQgaW4gdGhlIGhvcGUgdGhhdCBpdCB3aWxsIGJlIHVzZWZ1bCxcbi8vIGJ1dCBXSVRIT1VUIEFOWSBXQVJSQU5UWTsgd2l0aG91dCBldmVuIHRoZSBpbXBsaWVkIHdhcnJhbnR5IG9mXG4vLyBNRVJDSEFOVEFCSUxJVFkgb3IgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UuICBTZWUgdGhlXG4vLyBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuLy9cbi8vIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlXG4vLyBhbG9uZyB3aXRoIHRoaXMgcHJvZ3JhbTsgaWYgbm90LCB3cml0ZSB0byB0aGUgRnJlZSBTb2Z0d2FyZVxuLy8gRm91bmRhdGlvbiwgSW5jLiwgNTEgRnJhbmtsaW4gU3RyZWV0LCBGaWZ0aCBGbG9vciwgQm9zdG9uLCBNQSAgMDIxMTAtMTMwMSwgVVNBLlxuXG4vLyBTY3JhdGNoIEhUTUw1IFBsYXllclxuLy8gUHJpbWl0aXZlcy5qc1xuLy8gVGltIE1pY2tlbCwgSnVseSAyMDExXG5cbi8vIFByb3ZpZGVzIHRoZSBiYXNpYyBwcmltaXRpdmVzIGZvciB0aGUgaW50ZXJwcmV0ZXIgYW5kIGxvYWRzIGluIHRoZSBtb3JlXG4vLyBjb21wbGljYXRlZCBwcmltaXRpdmVzLCBlLmcuIE1vdGlvbkFuZFBlblByaW1zLlxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBMb29rc1ByaW1zID0gcmVxdWlyZSgnLi9Mb29rc1ByaW1zJyksXG4gICAgTW90aW9uQW5kUGVuUHJpbXMgPSByZXF1aXJlKCcuL01vdGlvbkFuZFBlblByaW1zJyksXG4gICAgU2Vuc2luZ1ByaW1zID0gcmVxdWlyZSgnLi9TZW5zaW5nUHJpbXMnKSxcbiAgICBTb3VuZFByaW1zID0gcmVxdWlyZSgnLi9Tb3VuZFByaW1zJyksXG4gICAgVmFyTGlzdFByaW1zID0gcmVxdWlyZSgnLi9WYXJMaXN0UHJpbXMnKTtcblxuXG52YXIgUHJpbWl0aXZlcyA9IGZ1bmN0aW9uKCkge31cblxuUHJpbWl0aXZlcy5wcm90b3R5cGUuYWRkUHJpbXNUbyA9IGZ1bmN0aW9uKHByaW1UYWJsZSkge1xuICAgIC8vIE1hdGggcHJpbWl0aXZlc1xuICAgIHByaW1UYWJsZVsnKyddICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGludGVycC5udW1hcmcoYiwgMCkgKyBpbnRlcnAubnVtYXJnKGIsIDEpOyB9O1xuICAgIHByaW1UYWJsZVsnLSddICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGludGVycC5udW1hcmcoYiwgMCkgLSBpbnRlcnAubnVtYXJnKGIsIDEpOyB9O1xuICAgIHByaW1UYWJsZVsnKiddICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGludGVycC5udW1hcmcoYiwgMCkgKiBpbnRlcnAubnVtYXJnKGIsIDEpOyB9O1xuICAgIHByaW1UYWJsZVsnLyddICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGludGVycC5udW1hcmcoYiwgMCkgLyBpbnRlcnAubnVtYXJnKGIsIDEpOyB9O1xuICAgIHByaW1UYWJsZVsnJSddICAgICAgICA9IHRoaXMucHJpbU1vZHVsbztcbiAgICBwcmltVGFibGVbJ3JhbmRvbUZyb206dG86J10gPSB0aGlzLnByaW1SYW5kb207XG4gICAgcHJpbVRhYmxlWyc8J10gICAgICAgID0gZnVuY3Rpb24oYikgeyByZXR1cm4gKGludGVycC5udW1hcmcoYiwgMCkgPCBpbnRlcnAubnVtYXJnKGIsIDEpKTsgfTtcbiAgICBwcmltVGFibGVbJz0nXSAgICAgICAgPSBmdW5jdGlvbihiKSB7IHJldHVybiAoaW50ZXJwLmFyZyhiLCAwKSA9PSBpbnRlcnAuYXJnKGIsIDEpKTsgfTtcbiAgICBwcmltVGFibGVbJz4nXSAgICAgICAgPSBmdW5jdGlvbihiKSB7IHJldHVybiAoaW50ZXJwLm51bWFyZyhiLCAwKSA+IGludGVycC5udW1hcmcoYiwgMSkpOyB9O1xuICAgIHByaW1UYWJsZVsnJiddICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGludGVycC5ib29sYXJnKGIsIDApICYmIGludGVycC5ib29sYXJnKGIsIDEpOyB9O1xuICAgIHByaW1UYWJsZVsnfCddICAgICAgICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGludGVycC5ib29sYXJnKGIsIDApIHx8IGludGVycC5ib29sYXJnKGIsIDEpOyB9O1xuICAgIHByaW1UYWJsZVsnbm90J10gICAgICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuICFpbnRlcnAuYm9vbGFyZyhiLCAwKTsgfTtcbiAgICBwcmltVGFibGVbJ2FicyddICAgICAgPSBmdW5jdGlvbihiKSB7IHJldHVybiBNYXRoLmFicyhpbnRlcnAubnVtYXJnKGIsIDApKTsgfTtcbiAgICBwcmltVGFibGVbJ3NxcnQnXSAgICAgPSBmdW5jdGlvbihiKSB7IHJldHVybiBNYXRoLnNxcnQoaW50ZXJwLm51bWFyZyhiLCAwKSk7IH07XG5cbiAgICBwcmltVGFibGVbJ1xcXFxcXFxcJ10gICAgICAgICAgICAgICA9IHRoaXMucHJpbU1vZHVsbztcbiAgICBwcmltVGFibGVbJ3JvdW5kZWQnXSAgICAgICAgICAgID0gZnVuY3Rpb24oYikgeyByZXR1cm4gTWF0aC5yb3VuZChpbnRlcnAubnVtYXJnKGIsIDApKTsgfTtcbiAgICBwcmltVGFibGVbJ2NvbXB1dGVGdW5jdGlvbjpvZjonXSA9IHRoaXMucHJpbU1hdGhGdW5jdGlvbjtcblxuICAgIC8vIFN0cmluZyBwcmltaXRpdmVzXG4gICAgcHJpbVRhYmxlWydjb25jYXRlbmF0ZTp3aXRoOiddICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuICcnICsgaW50ZXJwLmFyZyhiLCAwKSArIGludGVycC5hcmcoYiwgMSk7IH07XG4gICAgcHJpbVRhYmxlWydsZXR0ZXI6b2Y6J10gICAgICAgICA9IHRoaXMucHJpbUxldHRlck9mO1xuICAgIHByaW1UYWJsZVsnc3RyaW5nTGVuZ3RoOiddICAgICAgPSBmdW5jdGlvbihiKSB7IHJldHVybiBpbnRlcnAuYXJnKGIsIDApLmxlbmd0aDsgfTtcblxuICAgIG5ldyBWYXJMaXN0UHJpbXMoKS5hZGRQcmltc1RvKHByaW1UYWJsZSk7XG4gICAgbmV3IE1vdGlvbkFuZFBlblByaW1zKCkuYWRkUHJpbXNUbyhwcmltVGFibGUpO1xuICAgIG5ldyBMb29rc1ByaW1zKCkuYWRkUHJpbXNUbyhwcmltVGFibGUpO1xuICAgIG5ldyBTZW5zaW5nUHJpbXMoKS5hZGRQcmltc1RvKHByaW1UYWJsZSk7XG4gICAgbmV3IFNvdW5kUHJpbXMoKS5hZGRQcmltc1RvKHByaW1UYWJsZSk7XG59XG5cblByaW1pdGl2ZXMucHJvdG90eXBlLnByaW1SYW5kb20gPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIG4xID0gaW50ZXJwLm51bWFyZyhiLCAwKTtcbiAgICB2YXIgbjIgPSBpbnRlcnAubnVtYXJnKGIsIDEpO1xuICAgIHZhciBsb3cgPSBuMSA8PSBuMiA/IG4xIDogbjI7XG4gICAgdmFyIGhpID0gbjEgPD0gbjIgPyBuMiA6IG4xO1xuICAgIGlmIChsb3cgPT0gaGkpIHJldHVybiBsb3c7XG4gICAgLy8gaWYgYm90aCBsb3cgYW5kIGhpIGFyZSBpbnRzLCB0cnVuY2F0ZSB0aGUgcmVzdWx0IHRvIGFuIGludFxuICAgIGlmIChNYXRoLmZsb29yKGxvdykgPT0gbG93ICYmIE1hdGguZmxvb3IoaGkpID09IGhpKSB7XG4gICAgICAgIHJldHVybiBsb3cgKyBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAoaGkgKyAxIC0gbG93KSk7XG4gICAgfVxuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpICogKGhpIC0gbG93KSArIGxvdztcbn1cblxuUHJpbWl0aXZlcy5wcm90b3R5cGUucHJpbUxldHRlck9mID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLmFyZyhiLCAxKTtcbiAgICB2YXIgaSA9IGludGVycC5udW1hcmcoYiwgMCkgLSAxO1xuICAgIGlmIChpIDwgMCB8fCBpID49IHMubGVuZ3RoKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIHMuY2hhckF0KGkpO1xufVxuXG5QcmltaXRpdmVzLnByb3RvdHlwZS5wcmltTW9kdWxvID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBkaXZpZGVuZCA9IGludGVycC5udW1hcmcoYiwgMSk7XG4gICAgdmFyIG4gPSBpbnRlcnAubnVtYXJnKGIsIDApICUgZGl2aWRlbmQ7XG4gICAgaWYgKG4gLyBkaXZpZGVuZCA8IDApIG4gKz0gZGl2aWRlbmQ7XG4gICAgcmV0dXJuIG47XG59XG5cblByaW1pdGl2ZXMucHJvdG90eXBlLnByaW1NYXRoRnVuY3Rpb24gPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIG9wID0gaW50ZXJwLmFyZyhiLCAwKTtcbiAgICB2YXIgbiA9IGludGVycC5udW1hcmcoYiwgMSk7XG4gICAgc3dpdGNoKG9wKSB7XG4gICAgICAgIGNhc2UgJ2Ficyc6IHJldHVybiBNYXRoLmFicyhuKTtcbiAgICAgICAgY2FzZSAnc3FydCc6IHJldHVybiBNYXRoLnNxcnQobik7XG4gICAgICAgIGNhc2UgJ3Npbic6IHJldHVybiBNYXRoLnNpbihuICogTWF0aC5QSSAvIDE4MCk7XG4gICAgICAgIGNhc2UgJ2Nvcyc6IHJldHVybiBNYXRoLmNvcyhuICogTWF0aC5QSSAvIDE4MCk7XG4gICAgICAgIGNhc2UgJ3Rhbic6IHJldHVybiBNYXRoLnRhbihuICogTWF0aC5QSSAvIDE4MCk7XG4gICAgICAgIGNhc2UgJ2FzaW4nOiByZXR1cm4gTWF0aC5hc2luKG4pICogMTgwIC8gTWF0aC5QSTtcbiAgICAgICAgY2FzZSAnYWNvcyc6IHJldHVybiBNYXRoLmFjb3MobikgKiAxODAgLyBNYXRoLlBJO1xuICAgICAgICBjYXNlICdhdGFuJzogcmV0dXJuIE1hdGguYXRhbihuKSAqIDE4MCAvIE1hdGguUEk7XG4gICAgICAgIGNhc2UgJ2xuJzogcmV0dXJuIE1hdGgubG9nKG4pO1xuICAgICAgICBjYXNlICdsb2cnOiByZXR1cm4gTWF0aC5sb2cobikgLyBNYXRoLkxOMTA7XG4gICAgICAgIGNhc2UgJ2UgXic6IHJldHVybiBNYXRoLmV4cChuKTtcbiAgICAgICAgY2FzZSAnMTAgXic6IHJldHVybiBNYXRoLmV4cChuICogTWF0aC5MTjEwKTtcbiAgICB9XG4gICAgcmV0dXJuIDA7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUHJpbWl0aXZlcztcbiIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgU2Vuc2luZ1ByaW1zID0gZnVuY3Rpb24oKSB7fTtcblxuU2Vuc2luZ1ByaW1zLnByb3RvdHlwZS5hZGRQcmltc1RvID0gZnVuY3Rpb24ocHJpbVRhYmxlKSB7XG4gICAgcHJpbVRhYmxlWyd0b3VjaGluZzonXSAgICAgID0gdGhpcy5wcmltVG91Y2hpbmc7XG4gICAgcHJpbVRhYmxlWyd0b3VjaGluZ0NvbG9yOiddID0gdGhpcy5wcmltVG91Y2hpbmdDb2xvcjtcbiAgICBwcmltVGFibGVbJ2NvbG9yOnNlZXM6J10gICAgPSB0aGlzLnByaW1Db2xvclRvdWNoaW5nQ29sb3I7XG5cbiAgICBwcmltVGFibGVbJ2RvQXNrJ10gICAgICAgICAgICAgID0gdGhpcy5wcmltRG9Bc2s7XG4gICAgcHJpbVRhYmxlWydhbnN3ZXInXSAgICAgICAgICAgICA9IHRoaXMucHJpbUFuc3dlcjtcblxuICAgIHByaW1UYWJsZVsna2V5UHJlc3NlZDonXSAgPSB0aGlzLnByaW1LZXlQcmVzc2VkO1xuICAgIHByaW1UYWJsZVsnbW91c2VQcmVzc2VkJ10gPSBmdW5jdGlvbihiKSB7IHJldHVybiBydW50aW1lLm1vdXNlRG93bjsgfTtcbiAgICBwcmltVGFibGVbJ21vdXNlWCddICAgICAgID0gZnVuY3Rpb24oYikgeyByZXR1cm4gcnVudGltZS5tb3VzZVBvc1swXTsgfTtcbiAgICBwcmltVGFibGVbJ21vdXNlWSddICAgICAgID0gZnVuY3Rpb24oYikgeyByZXR1cm4gcnVudGltZS5tb3VzZVBvc1sxXTsgfTtcbiAgICBwcmltVGFibGVbJ2Rpc3RhbmNlVG86J10gID0gdGhpcy5wcmltRGlzdGFuY2VUbztcblxuICAgIHByaW1UYWJsZVsnZ2V0QXR0cmlidXRlOm9mOiddID0gdGhpcy5wcmltR2V0QXR0cmlidXRlO1xuXG4gICAgcHJpbVRhYmxlWyd0aW1lQW5kRGF0ZSddICA9IGZ1bmN0aW9uKGIpIHsgcmV0dXJuIHJ1bnRpbWUuZ2V0VGltZVN0cmluZyhpbnRlcnAuYXJnKGIsIDApKTsgfTtcbiAgICBwcmltVGFibGVbJ3RpbWVzdGFtcCddID0gdGhpcy5wcmltVGltZXN0YW1wO1xufTtcblxuU2Vuc2luZ1ByaW1zLnByb3RvdHlwZS5wcmltVG91Y2hpbmcgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgPT0gbnVsbCB8fCAhcy52aXNpYmxlKSByZXR1cm4gZmFsc2U7XG5cbiAgICB2YXIgYXJnID0gaW50ZXJwLmFyZyhiLCAwKTtcbiAgICBpZiAoYXJnID09ICdfZWRnZV8nKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTsgLy8gVE9ET1xuICAgIH1cblxuICAgIGlmIChhcmcgPT0gJ19tb3VzZV8nKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTsgLy8gVE9ET1xuICAgIH1cblxuICAgIHZhciBzMiA9IHJ1bnRpbWUuc3ByaXRlTmFtZWQoYXJnKTtcbiAgICBpZiAoczIgPT0gbnVsbCB8fCAhczIudmlzaWJsZSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgcmV0dXJuIHNwcml0ZUhpdFRlc3QocywgczIpO1xufTtcblxuU2Vuc2luZ1ByaW1zLnByb3RvdHlwZS5wcmltVG91Y2hpbmdDb2xvciA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyA9PSBudWxsIHx8ICFzLnZpc2libGUpIHJldHVybiBmYWxzZTtcblxuICAgIHZhciBjb2xvciA9IGludGVycC5hcmcoYiwgMCk7XG5cbiAgICByZXR1cm4gc3RhZ2VDb2xvckhpdFRlc3QocywgY29sb3IpO1xufTtcblxuU2Vuc2luZ1ByaW1zLnByb3RvdHlwZS5wcmltQ29sb3JUb3VjaGluZ0NvbG9yID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzID09IG51bGwgfHwgIXMudmlzaWJsZSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgdmFyIG15Q29sb3IgPSBpbnRlcnAuYXJnKGIsIDApO1xuICAgIHZhciBzdGFnZUNvbG9yID0gaW50ZXJwLmFyZyhiLCAxKTtcblxuICAgIHJldHVybiBzdGFnZUNvbG9yQnlDb2xvckhpdFRlc3QocywgbXlDb2xvciwgc3RhZ2VDb2xvcik7XG59O1xuXG52YXIgc3ByaXRlSGl0VGVzdCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICB2YXIgaGl0Q2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gICAgaGl0Q2FudmFzLndpZHRoID0gNDgwO1xuICAgIGhpdENhbnZhcy5oZWlnaHQgPSAzNjA7XG4gICAgdmFyIGhpdFRlc3RlciA9IGhpdENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGhpdFRlc3Rlci5nbG9iYWxDb21wb3NpdGVPcGVyYXRpb24gPSAnc291cmNlLW92ZXInO1xuICAgIGEuc3RhbXAoaGl0VGVzdGVyLCAxMDApO1xuICAgIGhpdFRlc3Rlci5nbG9iYWxDb21wb3NpdGVPcGVyYXRpb24gPSAnc291cmNlLWluJztcbiAgICBiLnN0YW1wKGhpdFRlc3RlciwgMTAwKTtcblxuICAgIHZhciBhRGF0YSA9IGhpdFRlc3Rlci5nZXRJbWFnZURhdGEoMCwgMCwgNDgwLCAzNjApLmRhdGE7XG5cbiAgICB2YXIgcHhDb3VudCA9IGFEYXRhLmxlbmd0aDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHB4Q291bnQ7IGkgKz0gNCkge1xuICAgICAgICBpZiAoYURhdGFbaSszXSA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn07XG5cbnZhciBzdGFnZUNvbG9ySGl0VGVzdCA9IGZ1bmN0aW9uKHRhcmdldCwgY29sb3IpIHtcbiAgICB2YXIgciwgZywgYjtcbiAgICByID0gKGNvbG9yID4+IDE2KTtcbiAgICBnID0gKGNvbG9yID4+IDggJiAyNTUpO1xuICAgIGIgPSAoY29sb3IgJiAyNTUpO1xuXG4gICAgdmFyIHRhcmdldENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICAgIHRhcmdldENhbnZhcy53aWR0aCA9IDQ4MDtcbiAgICB0YXJnZXRDYW52YXMuaGVpZ2h0ID0gMzYwO1xuICAgIHZhciB0YXJnZXRUZXN0ZXIgPSB0YXJnZXRDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICB0YXJnZXQuc3RhbXAodGFyZ2V0VGVzdGVyLCAxMDApO1xuXG4gICAgdmFyIHN0YWdlQ2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gICAgc3RhZ2VDYW52YXMud2lkdGggPSA0ODA7XG4gICAgc3RhZ2VDYW52YXMuaGVpZ2h0ID0gMzYwO1xuICAgIHZhciBzdGFnZUNvbnRleHQgPSBzdGFnZUNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gICAgJC5lYWNoKHJ1bnRpbWUuc3ByaXRlcywgZnVuY3Rpb24oaSwgc3ByaXRlKSB7XG4gICAgICAgIGlmIChzcHJpdGUgIT0gdGFyZ2V0KVxuICAgICAgICAgICAgc3ByaXRlLnN0YW1wKHN0YWdlQ29udGV4dCwgMTAwKTtcbiAgICB9KTtcblxuICAgIHZhciBoaXREYXRhID0gc3RhZ2VDb250ZXh0LmdldEltYWdlRGF0YSgwLCAwLCBzdGFnZUNhbnZhcy53aWR0aCwgc3RhZ2VDYW52YXMuaGVpZ2h0KS5kYXRhO1xuICAgIHZhciBtZXNoRGF0YSA9IHRhcmdldFRlc3Rlci5nZXRJbWFnZURhdGEoMCwgMCwgdGFyZ2V0Q2FudmFzLndpZHRoLCB0YXJnZXRDYW52YXMuaGVpZ2h0KS5kYXRhO1xuICAgIHZhciBweENvdW50ID0gbWVzaERhdGEubGVuZ3RoO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHhDb3VudDsgaSArPSA0KSB7XG4gICAgICAgIGlmIChtZXNoRGF0YVtpKzNdID4gMCAmJiBoaXREYXRhW2ldID09IHIgJiYgaGl0RGF0YVtpKzFdID09IGcgJiYgaGl0RGF0YVtpKzJdID09IGIpXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xufTtcblxudmFyIHN0YWdlQ29sb3JCeUNvbG9ySGl0VGVzdCA9IGZ1bmN0aW9uKHRhcmdldCwgbXlDb2xvciwgb3RoZXJDb2xvcikge1xuICAgIHZhciB0aHJlc2hvbGRfYWNjZXB0YWJsZSA9IGZ1bmN0aW9uKGEsIGIsIGMsIHgsIHksIHopIHtcbiAgICAgICAgdmFyIGRpZmZfYSA9IE1hdGguYWJzKGEteCk7XG4gICAgICAgIHZhciBkaWZmX2IgPSBNYXRoLmFicyhiLXkpO1xuICAgICAgICB2YXIgZGlmZl9jID0gTWF0aC5hYnMoYy16KTtcbiAgICAgICAgaWYgKGRpZmZfYSArIGRpZmZfYiArIGRpZmZfYyA8IDEwMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH07XG4gICAgdmFyIHRhcmdldENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICAgIHRhcmdldENhbnZhcy53aWR0aCA9IDQ4MDtcbiAgICB0YXJnZXRDYW52YXMuaGVpZ2h0ID0gMzYwO1xuICAgIHZhciB0YXJnZXRUZXN0ZXIgPSB0YXJnZXRDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICB0YXJnZXQuc3RhbXAodGFyZ2V0VGVzdGVyLCAxMDApO1xuICAgIHZhciB0YXJnZXREYXRhID0gdGFyZ2V0VGVzdGVyLmdldEltYWdlRGF0YSgwLCAwLCB0YXJnZXRDYW52YXMud2lkdGgsIHRhcmdldENhbnZhcy5oZWlnaHQpLmRhdGE7XG5cbiAgICAvLyBDYWxjdWxhdGUgUkdCIHZhbHVlcyBvZiB0aGUgY29sb3JzIC0gVE9ETyB0aHJlc2hvbGRpbmdcbiAgICAvL215Q29sb3IgPSBNYXRoLmFicyhteUNvbG9yKTtcbiAgICAvL290aGVyQ29sb3IgPSBNYXRoLmFicyhvdGhlckNvbG9yKTtcbiAgICB2YXIgbXIsIG1nLCBtYiwgb3IsIG9nLCBvYjtcbiAgICBtciA9IChteUNvbG9yID4+IDE2KTtcbiAgICBtZyA9IChteUNvbG9yID4+IDggJiAyNTUpO1xuICAgIG1iID0gKG15Q29sb3IgJiAyNTUpO1xuICAgIG9yID0gKG90aGVyQ29sb3IgPj4gMTYpO1xuICAgIG9nID0gKG90aGVyQ29sb3IgPj4gOCAmIDI1NSk7XG4gICAgb2IgPSAob3RoZXJDb2xvciAmIDI1NSk7XG5cbiAgICAvLyBDcmVhdGUgdGhlIGhpdCBjYW52YXMgZm9yIGNvbXBhcmlzb25cbiAgICB2YXIgaGl0Q2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gICAgaGl0Q2FudmFzLndpZHRoID0gNDgwO1xuICAgIGhpdENhbnZhcy5oZWlnaHQgPSAzNjA7XG4gICAgdmFyIGhpdEN0eCA9IGhpdENhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgICQuZWFjaChydW50aW1lLnNwcml0ZXMsIGZ1bmN0aW9uKGksIHNwcml0ZSkge1xuICAgICAgICBpZiAoc3ByaXRlICE9IHRhcmdldCkge1xuICAgICAgICAgICAgc3ByaXRlLnN0YW1wKGhpdEN0eCwgMTAwKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgdmFyIGhpdERhdGEgPSBoaXRDdHguZ2V0SW1hZ2VEYXRhKDAsIDAsIGhpdENhbnZhcy53aWR0aCwgaGl0Q2FudmFzLmhlaWdodCkuZGF0YTtcbiAgICB2YXIgcHhDb3VudCA9IHRhcmdldERhdGEubGVuZ3RoO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHhDb3VudDsgaSArPSA0KSB7XG4gICAgICAgIGlmICh0aHJlc2hvbGRfYWNjZXB0YWJsZSh0YXJnZXREYXRhW2ldLCB0YXJnZXREYXRhW2krMV0sIHRhcmdldERhdGFbaSsyXSwgbXIsIG1nLCBtYikgJiYgdGhyZXNob2xkX2FjY2VwdGFibGUoaGl0RGF0YVtpXSwgaGl0RGF0YVtpKzFdLCBoaXREYXRhW2krMl0sIG9yLCBvZywgb2IpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59O1xuXG5TZW5zaW5nUHJpbXMucHJvdG90eXBlLnByaW1Eb0Fzaz0gZnVuY3Rpb24oYikge1xuICAgIHNob3dCdWJibGUoYiwgXCJkb0Fza1wiKTtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyAhPT0gbnVsbCkge1xuICAgICAgICBpbnRlcnAuYWN0aXZlVGhyZWFkLnBhdXNlZCA9IHRydWU7XG4gICAgICAgIHMuc2hvd0FzaygpO1xuICAgIH1cbn07XG5cblNlbnNpbmdQcmltcy5wcm90b3R5cGUucHJpbUFuc3dlciA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTdGFnZSgpO1xuICAgIHJldHVybiAocyAhPT0gbnVsbCA/IHMuYXNrQW5zd2VyIDogdW5kZWZpbmVkKTtcbn07XG5cblxuU2Vuc2luZ1ByaW1zLnByb3RvdHlwZS5wcmltS2V5UHJlc3NlZCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIga2V5ID0gaW50ZXJwLmFyZyhiLCAwKTtcbiAgICB2YXIgY2ggPSBrZXkuY2hhckNvZGVBdCgwKTtcbiAgICBpZiAoY2ggPiAxMjcpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoa2V5ID09IFwibGVmdCBhcnJvd1wiKSBjaCA9IDM3O1xuICAgIGlmIChrZXkgPT0gXCJyaWdodCBhcnJvd1wiKSBjaCA9IDM5O1xuICAgIGlmIChrZXkgPT0gXCJ1cCBhcnJvd1wiKSBjaCA9IDM4O1xuICAgIGlmIChrZXkgPT0gXCJkb3duIGFycm93XCIpIGNoID0gNDA7XG4gICAgaWYgKGtleSA9PSBcInNwYWNlXCIpIGNoID0gMzI7XG4gICAgcmV0dXJuICh0eXBlb2YocnVudGltZS5rZXlzRG93bltjaF0pICE9ICd1bmRlZmluZWQnKTtcbn07XG5cblNlbnNpbmdQcmltcy5wcm90b3R5cGUucHJpbURpc3RhbmNlVG8gPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgdmFyIHAgPSBtb3VzZU9yU3ByaXRlUG9zaXRpb24oaW50ZXJwLmFyZyhiLCAwKSk7XG4gICAgaWYgKHMgPT0gbnVsbCB8fCBwID09IG51bGwpIHJldHVybiAwO1xuICAgIHZhciBkeCA9IHAueCAtIHMuc2NyYXRjaFg7XG4gICAgdmFyIGR5ID0gcC55IC0gcy5zY3JhdGNoWTtcbiAgICByZXR1cm4gTWF0aC5zcXJ0KChkeCAqIGR4KSArIChkeSAqIGR5KSk7XG59O1xuXG5TZW5zaW5nUHJpbXMucHJvdG90eXBlLnByaW1HZXRBdHRyaWJ1dGUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIGF0dHIgPSBpbnRlcnAuYXJnKGIsIDApO1xuICAgIHZhciB0YXJnZXRTcHJpdGUgPSBydW50aW1lLnNwcml0ZU5hbWVkKGludGVycC5hcmcoYiwgMSkpO1xuICAgIGlmICh0YXJnZXRTcHJpdGUgPT0gbnVsbCkgcmV0dXJuIDA7XG4gICAgaWYgKGF0dHIgPT0gJ3ggcG9zaXRpb24nKSByZXR1cm4gdGFyZ2V0U3ByaXRlLnNjcmF0Y2hYO1xuICAgIGlmIChhdHRyID09ICd5IHBvc2l0aW9uJykgcmV0dXJuIHRhcmdldFNwcml0ZS5zY3JhdGNoWTtcbiAgICBpZiAoYXR0ciA9PSAnZGlyZWN0aW9uJykgcmV0dXJuIHRhcmdldFNwcml0ZS5kaXJlY3Rpb247XG4gICAgaWYgKGF0dHIgPT0gJ2Nvc3R1bWUgIycpIHJldHVybiB0YXJnZXRTcHJpdGUuY3VycmVudENvc3R1bWVJbmRleCArIDE7XG4gICAgaWYgKGF0dHIgPT0gJ2Nvc3R1bWUgbmFtZScpIHJldHVybiB0YXJnZXRTcHJpdGUuY29zdHVtZXNbdGFyZ2V0U3ByaXRlLmN1cnJlbnRDb3N0dW1lSW5kZXhdWydjb3N0dW1lTmFtZSddO1xuICAgIGlmIChhdHRyID09ICdzaXplJykgcmV0dXJuIHRhcmdldFNwcml0ZS5nZXRTaXplKCk7XG4gICAgaWYgKGF0dHIgPT0gJ3ZvbHVtZScpIHJldHVybiB0YXJnZXRTcHJpdGUudm9sdW1lO1xuICAgIHJldHVybiAwO1xufTtcblxuU2Vuc2luZ1ByaW1zLnByb3RvdHlwZS5wcmltVGltZURhdGUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIGR0ID0gaW50ZXJwLmFyZyhiLCAwKTtcbiAgICB2YXIgbm93ID0gbmV3IERhdGUoKTtcbiAgICBpZiAoZHQgPT0gJ3llYXInKSByZXR1cm4gbm93LmdldEZ1bGxZZWFyKCk7XG4gICAgaWYgKGR0ID09ICdtb250aCcpIHJldHVybiBub3cuZ2V0TW9udGgoKSsxO1xuICAgIGlmIChkdCA9PSAnZGF0ZScpIHJldHVybiBub3cuZ2V0RGF0ZSgpO1xuICAgIGlmIChkdCA9PSAnZGF5IG9mIHdlZWsnKSByZXR1cm4gbm93LmdldERheSgpKzE7XG4gICAgaWYgKGR0ID09ICdob3VyJykgcmV0dXJuIG5vdy5nZXRIb3VycygpO1xuICAgIGlmIChkdCA9PSAnbWludXRlJykgcmV0dXJuIG5vdy5nZXRNaW51dGVzKCk7XG4gICAgaWYgKGR0ID09ICdzZWNvbmQnKSByZXR1cm4gbm93LmdldFNlY29uZHMoKTtcbiAgICByZXR1cm4gMDtcbn07XG5cblNlbnNpbmdQcmltcy5wcm90b3R5cGUucHJpbVRpbWVzdGFtcCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgbm93ID0gbmV3IERhdGUoKTtcbiAgICB2YXIgZXBvY2ggPSBuZXcgRGF0ZSgyMDAwLCAwLCAxKTtcbiAgICB2YXIgZHN0ID0gbm93LmdldFRpbWV6b25lT2Zmc2V0KCkgLSBlcG9jaC5nZXRUaW1lem9uZU9mZnNldCgpO1xuICAgIHZhciBtc1NpbmNlID0gbm93LmdldFRpbWUoKSAtIGVwb2NoLmdldFRpbWUoKTtcbiAgICBtc1NpbmNlIC09IGRzdCAqIDYwMDAwO1xuICAgIHJldHVybiBtc1NpbmNlIC8gODY0MDAwMDA7XG59O1xuXG4vLyBIZWxwZXJzXG5TZW5zaW5nUHJpbXMucHJvdG90eXBlLm1vdXNlT3JTcHJpdGVQb3NpdGlvbiA9IGZ1bmN0aW9uKGFyZykge1xuICAgIGlmIChhcmcgPT0gXCJfbW91c2VfXCIpIHtcbiAgICAgICAgdmFyIHcgPSBydW50aW1lLnN0YWdlO1xuICAgICAgICByZXR1cm4gbmV3IFBvaW50KHJ1bnRpbWUubW91c2VQb3NbMF0sIHJ1bnRpbWUubW91c2VQb3NbMV0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBzID0gcnVudGltZS5zcHJpdGVOYW1lZChhcmcpO1xuICAgICAgICBpZiAocyA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIG5ldyBQb2ludChzLnNjcmF0Y2hYLCBzLnNjcmF0Y2hZKTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlbnNpbmdQcmltcztcbiIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgU291bmRQcmltcyA9IGZ1bmN0aW9uKCkge307XG5cblNvdW5kUHJpbXMucHJvdG90eXBlLmFkZFByaW1zVG8gPSBmdW5jdGlvbihwcmltVGFibGUpIHtcbiAgICBwcmltVGFibGVbJ3BsYXlTb3VuZDonXSA9IHRoaXMucHJpbVBsYXlTb3VuZDtcbiAgICBwcmltVGFibGVbJ2RvUGxheVNvdW5kQW5kV2FpdCddID0gdGhpcy5wcmltUGxheVNvdW5kVW50aWxEb25lO1xuICAgIHByaW1UYWJsZVsnc3RvcEFsbFNvdW5kcyddID0gdGhpcy5wcmltU3RvcEFsbFNvdW5kcztcblxuICAgIHByaW1UYWJsZVsncGxheURydW0nXSA9IHRoaXMucHJpbVBsYXlEcnVtO1xuICAgIHByaW1UYWJsZVsncmVzdDplbGFwc2VkOmZyb206J10gPSB0aGlzLnByaW1QbGF5UmVzdDtcbiAgICBwcmltVGFibGVbJ25vdGVPbjpkdXJhdGlvbjplbGFwc2VkOmZyb206J10gPSB0aGlzLnByaW1QbGF5Tm90ZTtcbiAgICBwcmltVGFibGVbJ2luc3RydW1lbnQ6J10gPSB0aGlzLnByaW1TZXRJbnN0cnVtZW50O1xuXG4gICAgLypwcmltVGFibGVbJ2NoYW5nZVZvbHVtZUJ5OiddID0gdGhpcy5wcmltQ2hhbmdlVm9sdW1lO1xuICAgIHByaW1UYWJsZVsnc2V0Vm9sdW1lVG86J10gPSB0aGlzLnByaW1TZXRWb2x1bWU7XG4gICAgcHJpbVRhYmxlWyd2b2x1bWUnXSA9IHRoaXMucHJpbVZvbHVtZTsqL1xuXG4gICAgcHJpbVRhYmxlWydjaGFuZ2VUZW1wb0J5OiddID0gZnVuY3Rpb24oYikgeyBydW50aW1lLnN0YWdlLmRhdGEudGVtcG9CUE0gPSBydW50aW1lLnN0YWdlLmRhdGEudGVtcG9CUE0gKyBpbnRlcnAuYXJnKGIsIDApOyB9O1xuICAgIHByaW1UYWJsZVsnc2V0VGVtcG9UbzonXSA9IGZ1bmN0aW9uKGIpIHsgcnVudGltZS5zdGFnZS5kYXRhLnRlbXBvQlBNID0gaW50ZXJwLmFyZyhiLCAwKTsgfTtcbiAgICBwcmltVGFibGVbJ3RlbXBvJ10gPSBmdW5jdGlvbihiKSB7IHJldHVybiBydW50aW1lLnN0YWdlLmRhdGEudGVtcG9CUE07IH07XG59O1xuXG52YXIgcGxheVNvdW5kID0gZnVuY3Rpb24oc25kKSB7XG4gICAgaWYgKHNuZC5zb3VyY2UpIHtcbiAgICAgICAgLy8gSWYgdGhpcyBwYXJ0aWN1bGFyIHNvdW5kIGlzIGFscmVhZHkgcGxheWluZywgc3RvcCBpdC5cbiAgICAgICAgc25kLnNvdXJjZS5ub3RlT2ZmKDApO1xuICAgICAgICBzbmQuc291cmNlID0gbnVsbDtcbiAgICB9XG5cbiAgICBzbmQuc291cmNlID0gcnVudGltZS5hdWRpb0NvbnRleHQuY3JlYXRlQnVmZmVyU291cmNlKCk7XG4gICAgc25kLnNvdXJjZS5idWZmZXIgPSBzbmQuYnVmZmVyO1xuICAgIHNuZC5zb3VyY2UuY29ubmVjdChydW50aW1lLmF1ZGlvR2Fpbik7XG5cbiAgICAvLyBUcmFjayB0aGUgc291bmQncyBjb21wbGV0aW9uIHN0YXRlXG4gICAgc25kLnNvdXJjZS5kb25lID0gZmFsc2U7XG4gICAgc25kLnNvdXJjZS5maW5pc2hlZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAvLyBSZW1vdmUgZnJvbSB0aGUgYWN0aXZlIGF1ZGlvIGxpc3QgYW5kIGRpc2Nvbm5lY3QgdGhlIHNvdXJjZSBmcm9tXG4gICAgICAgIC8vIHRoZSBzb3VuZCBkaWN0aW9uYXJ5LlxuICAgICAgICB2YXIgaSA9IHJ1bnRpbWUuYXVkaW9QbGF5aW5nLmluZGV4T2Yoc25kKTtcbiAgICAgICAgaWYgKGkgPiAtMSAmJiBydW50aW1lLmF1ZGlvUGxheWluZ1tpXS5zb3VyY2UgIT0gbnVsbCkge1xuICAgICAgICAgICAgcnVudGltZS5hdWRpb1BsYXlpbmdbaV0uc291cmNlLmRvbmUgPSB0cnVlO1xuICAgICAgICAgICAgcnVudGltZS5hdWRpb1BsYXlpbmdbaV0uc291cmNlID0gbnVsbDtcbiAgICAgICAgICAgIHJ1bnRpbWUuYXVkaW9QbGF5aW5nLnNwbGljZShpLCAxKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICB3aW5kb3cuc2V0VGltZW91dChzbmQuc291cmNlLmZpbmlzaGVkLCBzbmQuYnVmZmVyLmR1cmF0aW9uICogMTAwMCk7XG4gICAgLy8gQWRkIHRoZSBnbG9iYWwgbGlzdCBvZiBwbGF5aW5nIHNvdW5kcyBhbmQgc3RhcnQgcGxheWluZy5cbiAgICBydW50aW1lLmF1ZGlvUGxheWluZy5wdXNoKHNuZCk7XG4gICAgc25kLnNvdXJjZS5ub3RlT24oMCk7XG4gICAgcmV0dXJuIHNuZC5zb3VyY2U7XG59O1xuXG52YXIgcGxheURydW0gPSBmdW5jdGlvbihkcnVtLCBzZWNzLCBjbGllbnQpIHtcbiAgICB2YXIgcGxheWVyID0gU291bmRCYW5rLmdldERydW1QbGF5ZXIoZHJ1bSwgc2Vjcyk7XG4gICAgcGxheWVyLmNsaWVudCA9IGNsaWVudDtcbiAgICBwbGF5ZXIuc2V0RHVyYXRpb24oc2Vjcyk7XG4gICAgdmFyIHNvdXJjZSA9IHJ1bnRpbWUuYXVkaW9Db250ZXh0LmNyZWF0ZVNjcmlwdFByb2Nlc3Nvcig0MDk2LCAxLCAxKTtcbiAgICBzb3VyY2Uub25hdWRpb3Byb2Nlc3MgPSBmdW5jdGlvbihlKSB7IHBsYXllci53cml0ZVNhbXBsZURhdGEoZSk7IH07XG4gICAgc291cmNlLnNvdW5kUGxheWVyID0gcGxheWVyO1xuICAgIHNvdXJjZS5jb25uZWN0KHJ1bnRpbWUuYXVkaW9HYWluKTtcbiAgICBydW50aW1lLm5vdGVzUGxheWluZy5wdXNoKHNvdXJjZSk7XG4gICAgc291cmNlLmZpbmlzaGVkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBpID0gcnVudGltZS5ub3Rlc1BsYXlpbmcuaW5kZXhPZihzb3VyY2UpO1xuICAgICAgICBpZiAoaSA+IC0xICYmIHJ1bnRpbWUubm90ZXNQbGF5aW5nW2ldICE9IG51bGwpIHtcbiAgICAgICAgICAgIHJ1bnRpbWUubm90ZXNQbGF5aW5nLnNwbGljZShpLCAxKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICB3aW5kb3cuc2V0VGltZW91dChzb3VyY2UuZmluaXNoZWQsIHNlY3MgKiAxMDAwKTtcbiAgICByZXR1cm4gcGxheWVyO1xufTtcblxudmFyIHBsYXlOb3RlID0gZnVuY3Rpb24oaW5zdHJ1bWVudCwgbWlkaUtleSwgc2VjcywgY2xpZW50KSB7XG4gICAgdmFyIHBsYXllciA9ICBTb3VuZEJhbmsuZ2V0Tm90ZVBsYXllcihpbnN0cnVtZW50LCBtaWRpS2V5KTtcbiAgICBwbGF5ZXIuY2xpZW50ID0gY2xpZW50O1xuICAgIHBsYXllci5zZXROb3RlQW5kRHVyYXRpb24obWlkaUtleSwgc2Vjcyk7XG4gICAgdmFyIHNvdXJjZSA9IHJ1bnRpbWUuYXVkaW9Db250ZXh0LmNyZWF0ZVNjcmlwdFByb2Nlc3Nvcig0MDk2LCAxLCAxKTtcbiAgICBzb3VyY2Uub25hdWRpb3Byb2Nlc3MgPSBmdW5jdGlvbihlKSB7IHBsYXllci53cml0ZVNhbXBsZURhdGEoZSk7IH07XG4gICAgc291cmNlLmNvbm5lY3QocnVudGltZS5hdWRpb0dhaW4pO1xuICAgIHJ1bnRpbWUubm90ZXNQbGF5aW5nLnB1c2goc291cmNlKTtcbiAgICBzb3VyY2UuZmluaXNoZWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGkgPSBydW50aW1lLm5vdGVzUGxheWluZy5pbmRleE9mKHNvdXJjZSk7XG4gICAgICAgIGlmIChpID4gLTEgJiYgcnVudGltZS5ub3Rlc1BsYXlpbmdbaV0gIT0gbnVsbCkge1xuICAgICAgICAgICAgcnVudGltZS5ub3Rlc1BsYXlpbmcuc3BsaWNlKGksIDEpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHdpbmRvdy5zZXRUaW1lb3V0KHNvdXJjZS5maW5pc2hlZCwgc2VjcyAqIDEwMDApO1xuICAgIHJldHVybiBwbGF5ZXI7XG59O1xuXG52YXIgc3RvcEFsbFNvdW5kcyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBvbGRQbGF5aW5nID0gcnVudGltZS5hdWRpb1BsYXlpbmc7XG4gICAgcnVudGltZS5hdWRpb1BsYXlpbmcgPSBbXTtcbiAgICBmb3IgKHZhciBzID0gMDsgcyA8IG9sZFBsYXlpbmcubGVuZ3RoOyBzKyspIHtcbiAgICAgICAgaWYgKG9sZFBsYXlpbmdbc10uc291cmNlKSB7XG4gICAgICAgICAgICBvbGRQbGF5aW5nW3NdLnNvdXJjZS5ub3RlT2ZmKDApO1xuICAgICAgICAgICAgb2xkUGxheWluZ1tzXS5zb3VyY2UuZmluaXNoZWQoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhciBvbGRQbGF5aW5nID0gcnVudGltZS5ub3Rlc1BsYXlpbmc7XG4gICAgcnVudGltZS5ub3Rlc1BsYXlpbmcgPSBbXTtcbiAgICBmb3IgKHZhciBzID0gMDsgcyA8IG9sZFBsYXlpbmcubGVuZ3RoOyBzKyspIHtcbiAgICAgICAgaWYgKG9sZFBsYXlpbmdbc10pIHtcbiAgICAgICAgICAgIG9sZFBsYXlpbmdbc10uZGlzY29ubmVjdCgpO1xuICAgICAgICAgICAgb2xkUGxheWluZ1tzXS5maW5pc2hlZCgpO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuU291bmRQcmltcy5wcm90b3R5cGUucHJpbVBsYXlTb3VuZCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyA9PSBudWxsKSByZXR1cm47XG4gICAgdmFyIHNuZCA9IHMuc291bmROYW1lZChpbnRlcnAuYXJnKGIsIDApKTtcbiAgICBpZiAoc25kICE9IG51bGwpIHBsYXlTb3VuZChzbmQpO1xufTtcblxuU291bmRQcmltcy5wcm90b3R5cGUucHJpbVBsYXlTb3VuZFVudGlsRG9uZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgYWN0aXZlVGhyZWFkID0gaW50ZXJwLmFjdGl2ZVRocmVhZDtcbiAgICBpZiAoYWN0aXZlVGhyZWFkLmZpcnN0VGltZSkge1xuICAgICAgICB2YXIgc25kID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpLnNvdW5kTmFtZWQoaW50ZXJwLmFyZyhiLCAwKSk7XG4gICAgICAgIGlmIChzbmQgPT0gbnVsbCkgcmV0dXJuO1xuICAgICAgICBhY3RpdmVUaHJlYWQudG1wT2JqID0gcGxheVNvdW5kKHNuZCk7XG4gICAgICAgIGFjdGl2ZVRocmVhZC5maXJzdFRpbWUgPSBmYWxzZTtcbiAgICB9XG4gICAgdmFyIHBsYXllciA9IGFjdGl2ZVRocmVhZC50bXBPYmo7XG4gICAgaWYgKHBsYXllciA9PSBudWxsIHx8IHBsYXllci5kb25lIHx8IHBsYXllci5wbGF5YmFja1N0YXRlID09IDMpIHtcbiAgICAgICAgYWN0aXZlVGhyZWFkLnRtcE9iaiA9IG51bGw7XG4gICAgICAgIGFjdGl2ZVRocmVhZC5maXJzdFRpbWUgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGludGVycC55aWVsZCA9IHRydWU7XG4gICAgfVxufTtcblxudmFyIGJlYXRzVG9TZWNvbmRzID0gZnVuY3Rpb24oYmVhdHMpIHtcbiAgICByZXR1cm4gYmVhdHMgKiA2MCAvIHJ1bnRpbWUuc3RhZ2UuZGF0YS50ZW1wb0JQTTtcbn07XG5cblNvdW5kUHJpbXMucHJvdG90eXBlLnByaW1QbGF5Tm90ZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyA9PSBudWxsKSByZXR1cm47XG4gICAgaWYgKGludGVycC5hY3RpdmVUaHJlYWQuZmlyc3RUaW1lKSB7XG4gICAgICAgIHZhciBrZXkgPSBpbnRlcnAubnVtYXJnKGIsIDApO1xuICAgICAgICB2YXIgc2VjcyA9IGJlYXRzVG9TZWNvbmRzKGludGVycC5udW1hcmcoYiwgMSkpO1xuICAgICAgICBwbGF5Tm90ZShzLmluc3RydW1lbnQsIGtleSwgc2Vjcywgcyk7XG4gICAgICAgIGludGVycC5zdGFydFRpbWVyKHNlY3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGludGVycC5jaGVja1RpbWVyKCk7XG4gICAgfVxufTtcblxuU291bmRQcmltcy5wcm90b3R5cGUucHJpbVBsYXlEcnVtID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzID09IG51bGwpIHJldHVybjtcbiAgICBpZiAoaW50ZXJwLmFjdGl2ZVRocmVhZC5maXJzdFRpbWUpIHtcbiAgICAgICAgdmFyIGRydW0gPSBNYXRoLnJvdW5kKGludGVycC5udW1hcmcoYiwgMCkpO1xuICAgICAgICB2YXIgc2VjcyA9IGJlYXRzVG9TZWNvbmRzKGludGVycC5udW1hcmcoYiwgMSkpO1xuICAgICAgICBwbGF5RHJ1bShkcnVtLCBzZWNzLCBzKTtcbiAgICAgICAgaW50ZXJwLnN0YXJ0VGltZXIoc2Vjcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgaW50ZXJwLmNoZWNrVGltZXIoKTtcbiAgICB9XG59O1xuXG5Tb3VuZFByaW1zLnByb3RvdHlwZS5wcmltUGxheVJlc3QgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgPT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmIChpbnRlcnAuYWN0aXZlVGhyZWFkLmZpcnN0VGltZSkge1xuICAgICAgICB2YXIgc2VjcyA9IGJlYXRzVG9TZWNvbmRzKGludGVycC5udW1hcmcoYiwgMCkpO1xuICAgICAgICBpbnRlcnAuc3RhcnRUaW1lcihzZWNzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBpbnRlcnAuY2hlY2tUaW1lcigpO1xuICAgIH1cbn07XG5cblNvdW5kUHJpbXMucHJvdG90eXBlLnByaW1TZXRJbnN0cnVtZW50ID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzICE9IG51bGwpIHMuaW5zdHJ1bWVudCA9IGludGVycC5hcmcoYiwgMCk7XG59O1xuXG5Tb3VuZFByaW1zLnByb3RvdHlwZS5wcmltU3RvcEFsbFNvdW5kcyA9IGZ1bmN0aW9uKGIpIHtcbiAgICBzdG9wQWxsU291bmRzKCk7XG59O1xuXG5Tb3VuZFByaW1zLnByb3RvdHlwZS5wcmltQ2hhbmdlVm9sdW1lID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzICE9IG51bGwpIHMudm9sdW1lICs9IGludGVycC5udW1hcmcoYiwgMCk7XG59O1xuXG5Tb3VuZFByaW1zLnByb3RvdHlwZS5wcmltU2V0Vm9sdW1lID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzICE9IG51bGwpIHMudm9sdW1lID0gaW50ZXJwLm51bWFyZyhiLCAwKTtcbn07XG5cblNvdW5kUHJpbXMucHJvdG90eXBlLnByaW1Wb2x1bWUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgcmV0dXJuIHMgIT0gbnVsbCA/IHMudm9sdW1lIDogMDtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU291bmRQcmltcztcbm1vZHVsZS5leHBvcnRzLnN0b3BBbGxTb3VuZHMgPSBzdG9wQWxsU291bmRzO1xuIiwiLy8gQ29weXJpZ2h0IChDKSAyMDEzIE1hc3NhY2h1c2V0dHMgSW5zdGl0dXRlIG9mIFRlY2hub2xvZ3lcbi8vXG4vLyBUaGlzIHByb2dyYW0gaXMgZnJlZSBzb2Z0d2FyZTsgeW91IGNhbiByZWRpc3RyaWJ1dGUgaXQgYW5kL29yXG4vLyBtb2RpZnkgaXQgdW5kZXIgdGhlIHRlcm1zIG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZSB2ZXJzaW9uIDIsXG4vLyBhcyBwdWJsaXNoZWQgYnkgdGhlIEZyZWUgU29mdHdhcmUgRm91bmRhdGlvbi5cbi8vXG4vLyBUaGlzIHByb2dyYW0gaXMgZGlzdHJpYnV0ZWQgaW4gdGhlIGhvcGUgdGhhdCBpdCB3aWxsIGJlIHVzZWZ1bCxcbi8vIGJ1dCBXSVRIT1VUIEFOWSBXQVJSQU5UWTsgd2l0aG91dCBldmVuIHRoZSBpbXBsaWVkIHdhcnJhbnR5IG9mXG4vLyBNRVJDSEFOVEFCSUxJVFkgb3IgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UuICBTZWUgdGhlXG4vLyBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuLy9cbi8vIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlXG4vLyBhbG9uZyB3aXRoIHRoaXMgcHJvZ3JhbTsgaWYgbm90LCB3cml0ZSB0byB0aGUgRnJlZSBTb2Z0d2FyZVxuLy8gRm91bmRhdGlvbiwgSW5jLiwgNTEgRnJhbmtsaW4gU3RyZWV0LCBGaWZ0aCBGbG9vciwgQm9zdG9uLCBNQSAgMDIxMTAtMTMwMSwgVVNBLlxuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBWYXJMaXN0UHJpbXMgPSBmdW5jdGlvbigpIHt9XG5cblZhckxpc3RQcmltcy5wcm90b3R5cGUuYWRkUHJpbXNUbyA9IGZ1bmN0aW9uKHByaW1UYWJsZSkge1xuICAgIC8vIFZhcmlhYmxlIHByaW1pdGl2ZXNcbiAgICBwcmltVGFibGVbJ3JlYWRWYXJpYWJsZSddICAgICAgICA9IHRoaXMucHJpbVJlYWRWYXI7XG4gICAgcHJpbVRhYmxlWydzZXRWYXI6dG86J10gICAgICAgICAgPSB0aGlzLnByaW1TZXRWYXI7XG4gICAgcHJpbVRhYmxlWydjaGFuZ2VWYXI6Ynk6J10gICAgICAgPSB0aGlzLnByaW1DaGFuZ2VWYXI7XG4gICAgcHJpbVRhYmxlWydoaWRlVmFyaWFibGU6J10gICAgICAgPSB0aGlzLnByaW1IaWRlVmFyO1xuICAgIHByaW1UYWJsZVsnc2hvd1ZhcmlhYmxlOiddICAgICAgID0gdGhpcy5wcmltU2hvd1ZhcjtcblxuICAgIC8vIExpc3QgcHJpbWl0aXZlc1xuICAgIHByaW1UYWJsZVsnY29udGVudHNPZkxpc3Q6J10gICAgICA9IHRoaXMucHJpbVJlYWRMaXN0O1xuICAgIHByaW1UYWJsZVsnYXBwZW5kOnRvTGlzdDonXSAgICAgID0gdGhpcy5wcmltTGlzdEFwcGVuZDtcbiAgICBwcmltVGFibGVbJ2RlbGV0ZUxpbmU6b2ZMaXN0OiddICA9IHRoaXMucHJpbUxpc3REZWxldGVMaW5lO1xuICAgIHByaW1UYWJsZVsnaW5zZXJ0OmF0Om9mTGlzdDonXSAgID0gdGhpcy5wcmltTGlzdEluc2VydEF0O1xuICAgIHByaW1UYWJsZVsnc2V0TGluZTpvZkxpc3Q6dG86J10gID0gdGhpcy5wcmltTGlzdFNldExpbmU7XG4gICAgcHJpbVRhYmxlWydsaW5lQ291bnRPZkxpc3Q6J10gICAgPSB0aGlzLnByaW1MaXN0TGVuZ3RoO1xuICAgIHByaW1UYWJsZVsnZ2V0TGluZTpvZkxpc3Q6J10gICAgID0gdGhpcy5wcmltTGlzdEdldExpbmU7XG4gICAgcHJpbVRhYmxlWydsaXN0OmNvbnRhaW5zOiddICAgICAgPSB0aGlzLnByaW1MaXN0Q29udGFpbnM7XG4gICAgcHJpbVRhYmxlWydoaWRlTGlzdDonXSAgICAgICA9IHRoaXMucHJpbUhpZGVMaXN0O1xuICAgIHByaW1UYWJsZVsnc2hvd0xpc3Q6J10gICAgICAgPSB0aGlzLnByaW1TaG93TGlzdDtcbn07XG5cbi8vIFZhcmlhYmxlIHByaW1pdGl2ZSBpbXBsZW1lbnRhdGlvbnNcblxuVmFyTGlzdFByaW1zLnByb3RvdHlwZS5wcmltUmVhZFZhciA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgcyA9IGludGVycC50YXJnZXRTcHJpdGUoKTtcbiAgICBpZiAocyA9PSBudWxsKSByZXR1cm47XG4gICAgdmFyIHRhcmdldFZhciA9IGludGVycC5hcmcoYiwgMCk7XG4gICAgaWYgKHRhcmdldFZhciBpbiBzLnZhcmlhYmxlcykge1xuICAgICAgICByZXR1cm4gcy52YXJpYWJsZXNbdGFyZ2V0VmFyXTtcbiAgICB9IGVsc2UgaWYgKHRhcmdldFZhciBpbiBydW50aW1lLnN0YWdlLnZhcmlhYmxlcykge1xuICAgICAgICByZXR1cm4gcnVudGltZS5zdGFnZS52YXJpYWJsZXNbdGFyZ2V0VmFyXTtcbiAgICB9XG59O1xuXG5WYXJMaXN0UHJpbXMucHJvdG90eXBlLnByaW1TZXRWYXIgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIHMgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCk7XG4gICAgaWYgKHMgPT0gbnVsbCkgcmV0dXJuO1xuICAgIHZhciB0YXJnZXRWYXIgPSBpbnRlcnAuYXJnKGIsIDApO1xuICAgIGlmICh0YXJnZXRWYXIgaW4gcy52YXJpYWJsZXMpIHtcbiAgICAgICAgcy52YXJpYWJsZXNbdGFyZ2V0VmFyXSA9IGludGVycC5hcmcoYiwgMSk7XG4gICAgfSBlbHNlIGlmICh0YXJnZXRWYXIgaW4gcnVudGltZS5zdGFnZS52YXJpYWJsZXMpIHtcbiAgICAgICAgcnVudGltZS5zdGFnZS52YXJpYWJsZXNbdGFyZ2V0VmFyXSA9IGludGVycC5hcmcoYiwgMSk7XG4gICAgfVxufTtcblxuVmFyTGlzdFByaW1zLnByb3RvdHlwZS5wcmltQ2hhbmdlVmFyID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBzID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpO1xuICAgIGlmIChzID09IG51bGwpIHJldHVybjtcbiAgICB2YXIgdGFyZ2V0VmFyID0gaW50ZXJwLmFyZyhiLCAwKTtcbiAgICBpZiAodGFyZ2V0VmFyIGluIHMudmFyaWFibGVzKSB7XG4gICAgICAgIHMudmFyaWFibGVzW3RhcmdldFZhcl0gPSBwYXJzZUZsb2F0KHMudmFyaWFibGVzW3RhcmdldFZhcl0pICsgaW50ZXJwLm51bWFyZyhiLCAxKTtcbiAgICB9IGVsc2UgaWYgKHRhcmdldFZhciBpbiBydW50aW1lLnN0YWdlLnZhcmlhYmxlcykge1xuICAgICAgICBydW50aW1lLnN0YWdlLnZhcmlhYmxlc1t0YXJnZXRWYXJdID0gcGFyc2VGbG9hdChydW50aW1lLnN0YWdlLnZhcmlhYmxlc1t0YXJnZXRWYXJdKSArIGludGVycC5udW1hcmcoYiwgMSk7XG4gICAgfVxufTtcblxuVmFyTGlzdFByaW1zLnByb3RvdHlwZS5wcmltSGlkZVZhciA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgdGFyZ2V0VmFyID0gaW50ZXJwLmFyZyhiLCAwKSwgdGFyZ2V0U3ByaXRlID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpLm9iak5hbWU7XG4gICAgZm9yICh2YXIgciA9IDA7IHIgPCBydW50aW1lLnJlcG9ydGVycy5sZW5ndGg7IHIrKykge1xuICAgICAgICBpZiAocnVudGltZS5yZXBvcnRlcnNbcl0uY21kID09ICdnZXRWYXI6JyAmJiBydW50aW1lLnJlcG9ydGVyc1tyXS5wYXJhbSA9PSB0YXJnZXRWYXIgJiYgKHJ1bnRpbWUucmVwb3J0ZXJzW3JdLnRhcmdldCA9PSB0YXJnZXRTcHJpdGUgfHwgcnVudGltZS5yZXBvcnRlcnNbcl0udGFyZ2V0ID09ICdTdGFnZScpKSB7XG4gICAgICAgICAgICBydW50aW1lLnJlcG9ydGVyc1tyXS52aXNpYmxlID0gZmFsc2U7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG5WYXJMaXN0UHJpbXMucHJvdG90eXBlLnByaW1TaG93VmFyID0gZnVuY3Rpb24oYikge1xuICAgIHZhciB0YXJnZXRWYXIgPSBpbnRlcnAuYXJnKGIsIDApLCB0YXJnZXRTcHJpdGUgPSBpbnRlcnAudGFyZ2V0U3ByaXRlKCkub2JqTmFtZTtcbiAgICBmb3IgKHZhciByID0gMDsgciA8IHJ1bnRpbWUucmVwb3J0ZXJzLmxlbmd0aDsgcisrKSB7XG4gICAgICAgIGlmIChydW50aW1lLnJlcG9ydGVyc1tyXS5jbWQgPT0gJ2dldFZhcjonICYmIHJ1bnRpbWUucmVwb3J0ZXJzW3JdLnBhcmFtID09IHRhcmdldFZhciAmJiAocnVudGltZS5yZXBvcnRlcnNbcl0udGFyZ2V0ID09IHRhcmdldFNwcml0ZSB8fCBydW50aW1lLnJlcG9ydGVyc1tyXS50YXJnZXQgPT0gJ1N0YWdlJykpIHtcbiAgICAgICAgICAgIHJ1bnRpbWUucmVwb3J0ZXJzW3JdLnZpc2libGUgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuLy8gTGlzdCBwcmltaXRpdmUgaW1wbGVtZW50YXRpb25zXG5cbi8vIFRha2UgYSBsaXN0IG5hbWUgYW5kIHRhcmdldCBzcHJpdGUgYW5kIHJldHVybiB0aGUgSlMgbGlzdCBpdHNlbGZcbmZ1bmN0aW9uIGZpbmRMaXN0KHRhcmdldFNwcml0ZSwgbGlzdE5hbWUpIHtcbiAgICBpZiAodGFyZ2V0U3ByaXRlID09IG51bGwpIHRhcmdldFNwcml0ZSA9IHJ1bnRpbWUuc3RhZ2U7XG4gICAgaWYgKGxpc3ROYW1lIGluIHRhcmdldFNwcml0ZS5saXN0cykge1xuICAgICAgICByZXR1cm4gdGFyZ2V0U3ByaXRlLmxpc3RzW2xpc3ROYW1lXS5jb250ZW50cztcbiAgICB9IGVsc2UgaWYgKGxpc3ROYW1lIGluIHJ1bnRpbWUuc3RhZ2UubGlzdHMpIHtcbiAgICAgICAgcmV0dXJuIHJ1bnRpbWUuc3RhZ2UubGlzdHNbbGlzdE5hbWVdLmNvbnRlbnRzO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuVmFyTGlzdFByaW1zLnByb3RvdHlwZS5wcmltUmVhZExpc3QgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIGxpc3QgPSBmaW5kTGlzdChpbnRlcnAudGFyZ2V0U3ByaXRlKCksIGludGVycC5hcmcoYiwgMCkpO1xuICAgIGlmIChsaXN0KSB7XG4gICAgICAgIHZhciBhbGxPbmUgPSBsaXN0Lm1hcChmdW5jdGlvbih2YWwpIHsgcmV0dXJuIHZhbC5sZW5ndGg7IH0pLnJlZHVjZShmdW5jdGlvbihvbGQsdmFsKSB7IHJldHVybiBvbGQgKyB2YWw7IH0sIDApID09PSBsaXN0Lmxlbmd0aDtcbiAgICAgICAgcmV0dXJuIGxpc3Quam9pbihhbGxPbmUgPyAnJyA6ICcgJyk7XG4gICAgfVxufTtcblxuVmFyTGlzdFByaW1zLnByb3RvdHlwZS5wcmltTGlzdEFwcGVuZCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgbGlzdCA9IGZpbmRMaXN0KGludGVycC50YXJnZXRTcHJpdGUoKSwgaW50ZXJwLmFyZyhiLCAxKSk7XG4gICAgaWYgKGxpc3QpIGxpc3QucHVzaChpbnRlcnAuYXJnKGIsIDApKTtcbn07XG5cblZhckxpc3RQcmltcy5wcm90b3R5cGUucHJpbUxpc3REZWxldGVMaW5lID0gZnVuY3Rpb24oYikge1xuICAgIHZhciBsaXN0ID0gZmluZExpc3QoaW50ZXJwLnRhcmdldFNwcml0ZSgpLCBpbnRlcnAuYXJnKGIsIDEpKTtcbiAgICBpZiAoIWxpc3QpIHJldHVybjtcbiAgICB2YXIgbGluZSA9IGludGVycC5hcmcoYiwgMCk7XG4gICAgaWYgKGxpbmUgPT0gJ2FsbCcgfHwgbGlzdC5sZW5ndGggPT0gMCkge1xuICAgICAgICBsaXN0Lmxlbmd0aCA9IDA7XG4gICAgfSBlbHNlIGlmIChsaW5lID09ICdsYXN0Jykge1xuICAgICAgICBsaXN0LnNwbGljZShsaXN0Lmxlbmd0aCAtIDEsIDEpO1xuICAgIH0gZWxzZSBpZiAocGFyc2VJbnQobGluZSwgMTApIC0gMSBpbiBsaXN0KSB7XG4gICAgICAgIGxpc3Quc3BsaWNlKHBhcnNlSW50KGxpbmUsIDEwKSAtIDEsIDEpO1xuICAgIH1cbn07XG5cblZhckxpc3RQcmltcy5wcm90b3R5cGUucHJpbUxpc3RJbnNlcnRBdCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgbGlzdCA9IGZpbmRMaXN0KGludGVycC50YXJnZXRTcHJpdGUoKSwgaW50ZXJwLmFyZyhiLCAyKSk7XG4gICAgaWYgKCFsaXN0KSByZXR1cm47XG4gICAgdmFyIG5ld0l0ZW0gPSBpbnRlcnAuYXJnKGIsIDApO1xuXG4gICAgdmFyIHBvc2l0aW9uID0gaW50ZXJwLmFyZyhiLCAxKTtcbiAgICBpZiAocG9zaXRpb24gPT0gJ2xhc3QnKSB7XG4gICAgICAgIHBvc2l0aW9uID0gbGlzdC5sZW5ndGg7XG4gICAgfSBlbHNlIGlmIChwb3NpdGlvbiA9PSAncmFuZG9tJykge1xuICAgICAgICBwb3NpdGlvbiA9IE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIGxpc3QubGVuZ3RoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBwb3NpdGlvbiA9IHBhcnNlSW50KHBvc2l0aW9uLCAxMCkgLSAxO1xuICAgIH1cbiAgICBpZiAocG9zaXRpb24gPiBsaXN0Lmxlbmd0aCkgcmV0dXJuO1xuXG4gICAgbGlzdC5zcGxpY2UocG9zaXRpb24sIDAsIG5ld0l0ZW0pO1xufTtcblxuVmFyTGlzdFByaW1zLnByb3RvdHlwZS5wcmltTGlzdFNldExpbmUgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIGxpc3QgPSBmaW5kTGlzdChpbnRlcnAudGFyZ2V0U3ByaXRlKCksIGludGVycC5hcmcoYiwgMSkpO1xuICAgIGlmICghbGlzdCkgcmV0dXJuO1xuICAgIHZhciBuZXdJdGVtID0gaW50ZXJwLmFyZyhiLCAyKTtcbiAgICB2YXIgcG9zaXRpb24gPSBpbnRlcnAuYXJnKGIsIDApO1xuXG4gICAgaWYgKHBvc2l0aW9uID09ICdsYXN0Jykge1xuICAgICAgICBwb3NpdGlvbiA9IGxpc3QubGVuZ3RoIC0gMTtcbiAgICB9IGVsc2UgaWYgKHBvc2l0aW9uID09ICdyYW5kb20nKSB7XG4gICAgICAgIHBvc2l0aW9uID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogbGlzdC5sZW5ndGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHBvc2l0aW9uID0gcGFyc2VJbnQocG9zaXRpb24sIDEwKSAtIDE7XG4gICAgfVxuXG4gICAgaWYgKHBvc2l0aW9uID4gbGlzdC5sZW5ndGggLSAxKSByZXR1cm47XG4gICAgbGlzdFtwb3NpdGlvbl0gPSBuZXdJdGVtO1xufTtcblxuVmFyTGlzdFByaW1zLnByb3RvdHlwZS5wcmltTGlzdExlbmd0aCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgbGlzdCA9IGZpbmRMaXN0KGludGVycC50YXJnZXRTcHJpdGUoKSwgaW50ZXJwLmFyZyhiLCAwKSk7XG4gICAgaWYgKCFsaXN0KSByZXR1cm4gMDtcbiAgICByZXR1cm4gbGlzdC5sZW5ndGg7XG59O1xuXG5WYXJMaXN0UHJpbXMucHJvdG90eXBlLnByaW1MaXN0R2V0TGluZSA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgbGlzdCA9IGZpbmRMaXN0KGludGVycC50YXJnZXRTcHJpdGUoKSwgaW50ZXJwLmFyZyhiLCAxKSk7XG4gICAgaWYgKCFsaXN0KSByZXR1cm4gMDtcbiAgICB2YXIgbGluZSA9IGludGVycC5hcmcoYiwgMCk7XG4gICAgaWYgKGxpc3QubGVuZ3RoID09IDApIHJldHVybiAwO1xuICAgIGlmIChsaW5lID09ICdyYW5kb20nKSBsaW5lID0gTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogbGlzdC5sZW5ndGgpO1xuICAgIGVsc2UgaWYgKGxpbmUgPT0gJ2xhc3QnKSBsaW5lID0gbGlzdC5sZW5ndGg7XG4gICAgZWxzZSBpZiAobGlzdC5sZW5ndGggPCBsaW5lKSByZXR1cm4gMDtcbiAgICByZXR1cm4gbGlzdFtsaW5lIC0gMV07XG59O1xuXG5WYXJMaXN0UHJpbXMucHJvdG90eXBlLnByaW1MaXN0Q29udGFpbnMgPSBmdW5jdGlvbihiKSB7XG4gICAgdmFyIGxpc3QgPSBmaW5kTGlzdChpbnRlcnAudGFyZ2V0U3ByaXRlKCksIGludGVycC5hcmcoYiwgMCkpO1xuICAgIGlmICghbGlzdCkgcmV0dXJuIDA7XG4gICAgdmFyIHNlYXJjaEl0ZW0gPSBpbnRlcnAuYXJnKGIsIDEpO1xuICAgIGlmIChwYXJzZUZsb2F0KHNlYXJjaEl0ZW0pID09IHNlYXJjaEl0ZW0pIHNlYXJjaEl0ZW0gPSBwYXJzZUZsb2F0KHNlYXJjaEl0ZW0pO1xuICAgIHJldHVybiAkLmluQXJyYXkoc2VhcmNoSXRlbSwgbGlzdCkgPiAtMTtcbn07XG5cblZhckxpc3RQcmltcy5wcm90b3R5cGUucHJpbUhpZGVMaXN0ID0gZnVuY3Rpb24oYikge1xuICAgIHZhciB0YXJnZXRMaXN0ID0gaW50ZXJwLmFyZyhiLCAwKSwgdGFyZ2V0U3ByaXRlID0gaW50ZXJwLnRhcmdldFNwcml0ZSgpLm9iak5hbWU7XG4gICAgZm9yICh2YXIgciA9IDA7IHIgPCBydW50aW1lLnJlcG9ydGVycy5sZW5ndGg7IHIrKykge1xuICAgICAgICBpZiAocnVudGltZS5yZXBvcnRlcnNbcl0gaW5zdGFuY2VvZiBMaXN0ICYmIHJ1bnRpbWUucmVwb3J0ZXJzW3JdLmxpc3ROYW1lID09IHRhcmdldExpc3QgJiYgKHJ1bnRpbWUucmVwb3J0ZXJzW3JdLnRhcmdldCA9PSB0YXJnZXRTcHJpdGUgfHwgcnVudGltZS5yZXBvcnRlcnNbcl0udGFyZ2V0ID09ICdTdGFnZScpKSB7XG4gICAgICAgICAgICBydW50aW1lLnJlcG9ydGVyc1tyXS52aXNpYmxlID0gZmFsc2U7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG5WYXJMaXN0UHJpbXMucHJvdG90eXBlLnByaW1TaG93TGlzdCA9IGZ1bmN0aW9uKGIpIHtcbiAgICB2YXIgdGFyZ2V0TGlzdCA9IGludGVycC5hcmcoYiwgMCksIHRhcmdldFNwcml0ZSA9IGludGVycC50YXJnZXRTcHJpdGUoKS5vYmpOYW1lO1xuICAgIGZvciAodmFyIHIgPSAwOyByIDwgcnVudGltZS5yZXBvcnRlcnMubGVuZ3RoOyByKyspIHtcbiAgICAgICAgaWYgKHJ1bnRpbWUucmVwb3J0ZXJzW3JdIGluc3RhbmNlb2YgTGlzdCAmJiBydW50aW1lLnJlcG9ydGVyc1tyXS5saXN0TmFtZSA9PSB0YXJnZXRMaXN0ICYmIChydW50aW1lLnJlcG9ydGVyc1tyXS50YXJnZXQgPT0gdGFyZ2V0U3ByaXRlIHx8IHJ1bnRpbWUucmVwb3J0ZXJzW3JdLnRhcmdldCA9PSAnU3RhZ2UnKSkge1xuICAgICAgICAgICAgcnVudGltZS5yZXBvcnRlcnNbcl0udmlzaWJsZSA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZhckxpc3RQcmltcztcbiIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuLy8gU291bmREZWNvZGVyLmpzXG4vLyBEZWNvZGUgV0FWIEZpbGVzICg4LWJpdCwgMTYtYml0LCBhbmQgQURQQ00pIGZvciBwbGF5aW5nIGJ5IFNwcml0ZXMuXG4vLyBGb3IgYmVzdCBwZXJmb3JtYW5jZSwgdGhpcyBzaG91bGQgYmUgcnVuIG9ubHkgb25jZSBwZXIgV0FWIGFuZFxuLy8gdGhlIGRlY29kZWQgYnVmZmVyIHNob3VsZCBiZSBjYWNoZWQuXG5cbi8vIEJhc2VkIGFsbW9zdCBlbnRpcmVseSBvbiBKb2huIE1hbG9uZXkncyBBUyBpbXBsZW1lbnRhdGlvbi5cblxudmFyIFdBVkZpbGUgPSByZXF1aXJlKCcuL1dBVkZpbGUnKTtcblxudmFyIFNvdW5kRGVjb2RlciA9IGZ1bmN0aW9uKHdhdkZpbGVEYXRhKSB7XG4gICAgdGhpcy5zY3JhdGNoU291bmQgPSBudWxsO1xuXG4gICAgdGhpcy5zb3VuZERhdGEgPSBudWxsO1xuICAgIHRoaXMuc3RhcnRPZmZzZXQgPSAwO1xuICAgIHRoaXMuZW5kT2Zmc2V0ID0gMDtcbiAgICB0aGlzLnN0ZXBTaXplID0gMDtcbiAgICB0aGlzLmFkcGNtQmxvY2tTaXplID0gMDtcbiAgICB0aGlzLmJ5dGVQb3NpdGlvbiA9IDA7XG4gICAgdGhpcy5zb3VuZENoYW5uZWwgPSBudWxsO1xuICAgIHRoaXMubGFzdEJ1ZmZlclRpbWUgPSAwO1xuXG4gICAgdGhpcy5nZXRTYW1wbGUgPSBudWxsO1xuICAgIHRoaXMuZnJhY3Rpb24gPSAwLjA7XG4gICAgdGhpcy50aGlzU2FtcGxlID0gMDtcblxuICAgIC8vIGRlY29kZXIgc3RhdGVcbiAgICB0aGlzLnNhbXBsZSA9IDA7XG4gICAgdGhpcy5pbmRleCA9IDA7XG4gICAgdGhpcy5sYXN0Qnl0ZSA9IC0xOyAvLyAtMSBpbmRpY2F0ZXMgdGhhdCB0aGVyZSBpcyBubyBzYXZlZCBsYXN0Qnl0ZVxuXG4gICAgdGhpcy5uZXh0U2FtcGxlID0gMDtcblxuICAgIHRoaXMuaW5mbyA9IG51bGw7XG5cbiAgICBnZXRTYW1wbGUgPSB0aGlzLmdldFNhbXBsZTE2VW5jb21wcmVzc2VkO1xuICAgIGlmICh3YXZGaWxlRGF0YSAhPSBudWxsKSB7XG4gICAgICAgIHZhciBpbmZvID0gV0FWRmlsZS5kZWNvZGUod2F2RmlsZURhdGEpO1xuICAgICAgICB0aGlzLmluZm8gPSBpbmZvO1xuICAgICAgICB0aGlzLnN0YXJ0T2Zmc2V0ID0gaW5mby5zYW1wbGVEYXRhU3RhcnQ7XG4gICAgICAgIHRoaXMuZW5kT2Zmc2V0ID0gdGhpcy5zdGFydE9mZnNldCArIGluZm8uc2FtcGxlRGF0YVNpemU7XG4gICAgICAgIHRoaXMuc291bmREYXRhID0gbmV3IFVpbnQ4QXJyYXkod2F2RmlsZURhdGEuc2xpY2UodGhpcy5zdGFydE9mZnNldCwgdGhpcy5lbmRPZmZzZXQpKTtcbiAgICAgICAgdGhpcy5zdGVwU2l6ZSA9IGluZm8uc2FtcGxlc1BlclNlY29uZCAvIDQ0MTAwLjA7XG4gICAgICAgIGlmIChpbmZvLmVuY29kaW5nID09IDE3KSB7XG4gICAgICAgICAgICB0aGlzLmFkcGNtQmxvY2tTaXplID0gaW5mby5hZHBjbUJsb2NrU2l6ZTtcbiAgICAgICAgICAgIHRoaXMuZ2V0U2FtcGxlID0gdGhpcy5nZXRTYW1wbGVBRFBDTTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChpbmZvLmJpdHNQZXJTYW1wbGUgPT0gOCkgdGhpcy5nZXRTYW1wbGUgPSB0aGlzLmdldFNhbXBsZThVbmNvbXByZXNzZWQ7XG4gICAgICAgICAgICBpZiAoaW5mby5iaXRzUGVyU2FtcGxlID09IDE2KSB0aGlzLmdldFNhbXBsZSA9IHRoaXMuZ2V0U2FtcGxlMTZVbmNvbXByZXNzZWQ7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG5Tb3VuZERlY29kZXIucHJvdG90eXBlLm5vdGVGaW5pc2hlZCA9IGZ1bmN0aW9uKCkge1xuICAgIC8vIENhbGxlZCBieSBzdWJjbGFzc2VzIHRvIGZvcmNlIGVuZGluZyBjb25kaXRpb24gdG8gYmUgdHJ1ZSBpbiB3cml0ZVNhbXBsZURhdGEoKVxuICAgIHRoaXMuYnl0ZVBvc2l0aW9uID0gdGhpcy5lbmRPZmZzZXQ7XG59O1xuXG4vLyBVc2VkIGZvciBOb3RlcyBhbmQgRHJ1bXMgLSBXZWIgQXVkaW8gQVBJIFNjcmlwdFByb2Nlc3Nvck5vZGVzIHVzZSB0aGlzXG4vLyBhcyBhIGNhbGxiYWNrIGZ1bmN0aW9uIHRvIGZpbGwgdGhlIGJ1ZmZlcnMgd2l0aCBzYW1wbGUgZGF0YS5cblNvdW5kRGVjb2Rlci5wcm90b3R5cGUud3JpdGVTYW1wbGVEYXRhID0gZnVuY3Rpb24oZXZ0KSB7XG4gICAgdmFyIGkgPSAwO1xuICAgIHZhciBvdXRwdXQgPSBldnQub3V0cHV0QnVmZmVyLmdldENoYW5uZWxEYXRhKDApO1xuICAgIC8vdGhpcy51cGRhdGVWb2x1bWUoKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgb3V0cHV0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBuID0gdGhpcy5pbnRlcnBvbGF0ZWRTYW1wbGUoKTtcbiAgICAgICAgb3V0cHV0W2ldID0gbjtcbiAgICB9XG59O1xuXG4vLyBGb3IgcHJlLWNhY2hpbmcgdGhlIHNhbXBsZXMgb2YgV0FWIHNvdW5kc1xuLy8gUmV0dXJuIGEgZnVsbCBsaXN0IG9mIHNhbXBsZXMgZ2VuZXJhdGVkIGJ5IHRoZSBkZWNvZGVyLlxuU291bmREZWNvZGVyLnByb3RvdHlwZS5nZXRBbGxTYW1wbGVzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNhbXBsZXMgPSBbXSwgc21wID0gMDtcbiAgICBzbXAgPSB0aGlzLmludGVycG9sYXRlZFNhbXBsZSgpO1xuICAgIHdoaWxlIChzbXAgIT0gbnVsbCkge1xuICAgICAgICBzYW1wbGVzLnB1c2goc21wKTtcbiAgICAgICAgc21wID0gdGhpcy5pbnRlcnBvbGF0ZWRTYW1wbGUoKTtcbiAgICB9XG4gICAgcmV0dXJuIHNhbXBsZXM7XG59O1xuXG4vLyBQcm92aWRlIHRoZSBuZXh0IHNhbXBsZSBmb3IgdGhlIGJ1ZmZlclxuU291bmREZWNvZGVyLnByb3RvdHlwZS5pbnRlcnBvbGF0ZWRTYW1wbGUgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZyYWN0aW9uICs9IHRoaXMuc3RlcFNpemU7XG4gICAgd2hpbGUgKHRoaXMuZnJhY3Rpb24gPj0gMS4wKSB7XG4gICAgICAgIHRoaXMudGhpc1NhbXBsZSA9IHRoaXMubmV4dFNhbXBsZTtcbiAgICAgICAgdGhpcy5uZXh0U2FtcGxlID0gdGhpcy5nZXRTYW1wbGUoKTtcbiAgICAgICAgdGhpcy5mcmFjdGlvbiAtPSAxLjA7XG4gICAgfVxuICAgIGlmICh0aGlzLm5leHRTYW1wbGUgPT0gbnVsbCkgeyByZXR1cm4gbnVsbDsgfVxuICAgIHZhciBvdXQgPSB0aGlzLmZyYWN0aW9uID09IDAgPyB0aGlzLnRoaXNTYW1wbGUgOiB0aGlzLnRoaXNTYW1wbGUgKyB0aGlzLmZyYWN0aW9uICogKHRoaXMubmV4dFNhbXBsZSAtIHRoaXMudGhpc1NhbXBsZSk7XG4gICAgcmV0dXJuIG91dCAvIDMyNzY4LjA7XG59O1xuXG4vLyAxNi1iaXQgc2FtcGxlcywgYmlnLWVuZGlhblxuU291bmREZWNvZGVyLnByb3RvdHlwZS5nZXRTYW1wbGUxNlVuY29tcHJlc3NlZCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXN1bHQgPSAwO1xuICAgIGlmICh0aGlzLmJ5dGVQb3NpdGlvbiA8PSAodGhpcy5pbmZvLnNhbXBsZURhdGFTaXplIC0gMikpIHtcbiAgICAgICAgcmVzdWx0ID0gKHRoaXMuc291bmREYXRhW3RoaXMuYnl0ZVBvc2l0aW9uICsgMV0gPDwgOCkgKyB0aGlzLnNvdW5kRGF0YVt0aGlzLmJ5dGVQb3NpdGlvbl07XG4gICAgICAgIGlmIChyZXN1bHQgPiAzMjc2NykgcmVzdWx0IC09IDY1NTM2O1xuICAgICAgICB0aGlzLmJ5dGVQb3NpdGlvbiArPSAyO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuYnl0ZVBvc2l0aW9uID0gdGhpcy5lbmRPZmZzZXQ7XG4gICAgICAgIHJlc3VsdCA9IG51bGw7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG4vLyA4LWJpdCBzYW1wbGVzLCB1bmNvbXByZXNzZWRcblNvdW5kRGVjb2Rlci5wcm90b3R5cGUuZ2V0U2FtcGxlOFVuY29tcHJlc3NlZCA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmJ5dGVQb3NpdGlvbiA+PSB0aGlzLmluZm8uc2FtcGxlRGF0YVNpemUpIHJldHVybiBudWxsO1xuICAgIHJldHVybiAodGhpcy5zb3VuZERhdGFbdGhpcy5ieXRlUG9zaXRpb24rK10gLSAxMjgpIDw8IDg7XG59O1xuXG4vKlNvdW5kRGVjb2Rlci5wcm90b3R5cGUudXBkYXRlVm9sdW1lID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY2xpZW50ID09IG51bGwpIHtcbiAgICAgICAgdGhpcy52b2x1bWUgPSAxLjA7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMuY2xpZW50LnZvbHVtZSA9PSB0aGlzLmxhc3RDbGllbnRWb2x1bWUpIHJldHVybjsgLy8gb3B0aW1pemF0aW9uXG4gICAgdGhpcy52b2x1bWUgPSBNYXRoLm1heCgwLjAsIE1hdGgubWluKHRoaXMuY2xpZW50LnZvbHVtZSAvIDEwMC4wLCAxLjApKTtcbiAgICB0aGlzLmxhc3RDbGllbnRWb2x1bWUgPSB0aGlzLmNsaWVudC52b2x1bWU7XG59Ki9cblxuLy8gRGVjb2RlciBmb3IgSU1BIEFEUENNIGNvbXByZXNzZWQgc291bmRzXG5Tb3VuZERlY29kZXIuaW5kZXhUYWJsZSA9IFstMSwgLTEsIC0xLCAtMSwgMiwgNCwgNiwgOCwgLTEsIC0xLCAtMSwgLTEsIDIsIDQsIDYsIDhdO1xuXG5Tb3VuZERlY29kZXIuc3RlcFRhYmxlID0gW1xuICAgIDcsIDgsIDksIDEwLCAxMSwgMTIsIDEzLCAxNCwgMTYsIDE3LCAxOSwgMjEsIDIzLCAyNSwgMjgsIDMxLCAzNCwgMzcsIDQxLCA0NSxcbiAgICA1MCwgNTUsIDYwLCA2NiwgNzMsIDgwLCA4OCwgOTcsIDEwNywgMTE4LCAxMzAsIDE0MywgMTU3LCAxNzMsIDE5MCwgMjA5LCAyMzAsXG4gICAgMjUzLCAyNzksIDMwNywgMzM3LCAzNzEsIDQwOCwgNDQ5LCA0OTQsIDU0NCwgNTk4LCA2NTgsIDcyNCwgNzk2LCA4NzYsIDk2MyxcbiAgICAxMDYwLCAxMTY2LCAxMjgyLCAxNDExLCAxNTUyLCAxNzA3LCAxODc4LCAyMDY2LCAyMjcyLCAyNDk5LCAyNzQ5LCAzMDI0LCAzMzI3LFxuICAgIDM2NjAsIDQwMjYsIDQ0MjgsIDQ4NzEsIDUzNTgsIDU4OTQsIDY0ODQsIDcxMzIsIDc4NDUsIDg2MzAsIDk0OTMsIDEwNDQyLCAxMTQ4NyxcbiAgICAxMjYzNSwgMTM4OTksIDE1Mjg5LCAxNjgxOCwgMTg1MDAsIDIwMzUwLCAyMjM4NSwgMjQ2MjMsIDI3MDg2LCAyOTc5NCwgMzI3Njdcbl07XG5cblNvdW5kRGVjb2Rlci5wcm90b3R5cGUuZ2V0U2FtcGxlQURQQ00gPSBmdW5jdGlvbigpIHtcbiAgICAvLyBEZWNvbXByZXNzIHNhbXBsZSBkYXRhIHVzaW5nIHRoZSBJTUEgQURQQ00gYWxnb3JpdGhtLlxuICAgIC8vIE5vdGU6IEhhbmRsZXMgb25seSBvbmUgY2hhbm5lbCwgNC1iaXRzL3NhbXBsZS5cbiAgICB2YXIgc3RlcCA9IDAsIGNvZGUgPSAwLCBkZWx0YSA9IDA7XG5cbiAgICBpZiAodGhpcy5ieXRlUG9zaXRpb24gJSB0aGlzLmFkcGNtQmxvY2tTaXplID09IDAgJiYgdGhpcy5sYXN0Qnl0ZSA8IDApIHsgLy8gcmVhZCBibG9jayBoZWFkZXJcbiAgICAgICAgaWYgKHRoaXMuYnl0ZVBvc2l0aW9uID4gdGhpcy5pbmZvLnNhbXBsZURhdGFTaXplIC0gNCkgcmV0dXJuIG51bGw7XG4gICAgICAgIHRoaXMuc2FtcGxlID0gKHRoaXMuc291bmREYXRhW3RoaXMuYnl0ZVBvc2l0aW9uICsgMV0gPDwgOCkgKyB0aGlzLnNvdW5kRGF0YVt0aGlzLmJ5dGVQb3NpdGlvbl07XG4gICAgICAgIGlmICh0aGlzLnNhbXBsZSA+IDMyNzY3KSB0aGlzLnNhbXBsZSAtPSA2NTUzNjtcbiAgICAgICAgdGhpcy5pbmRleCA9IHRoaXMuc291bmREYXRhW3RoaXMuYnl0ZVBvc2l0aW9uICsgMl07XG4gICAgICAgIHRoaXMuYnl0ZVBvc2l0aW9uICs9IDQ7XG4gICAgICAgIGlmICh0aGlzLmluZGV4ID4gODgpIHRoaXMuaW5kZXggPSA4ODtcbiAgICAgICAgdGhpcy5sYXN0Qnl0ZSA9IC0xO1xuICAgICAgICByZXR1cm4gdGhpcy5zYW1wbGU7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gcmVhZCA0LWJpdCBjb2RlIGFuZCBjb21wdXRlIGRlbHRhXG4gICAgICAgIGlmICh0aGlzLmxhc3RCeXRlIDwgMCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuYnl0ZVBvc2l0aW9uID49IHRoaXMuaW5mby5zYW1wbGVEYXRhU2l6ZSkgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB0aGlzLmxhc3RCeXRlID0gdGhpcy5zb3VuZERhdGFbdGhpcy5ieXRlUG9zaXRpb24rK107XG4gICAgICAgICAgICBjb2RlID0gdGhpcy5sYXN0Qnl0ZSAmIDB4RjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvZGUgPSAodGhpcy5sYXN0Qnl0ZSA+PiA0KSAmIDB4RjtcbiAgICAgICAgICAgIHRoaXMubGFzdEJ5dGUgPSAtMTtcbiAgICAgICAgfVxuICAgICAgICBzdGVwID0gU291bmREZWNvZGVyLnN0ZXBUYWJsZVt0aGlzLmluZGV4XTtcbiAgICAgICAgZGVsdGEgPSAwO1xuICAgICAgICBpZiAoY29kZSAmIDQpIGRlbHRhICs9IHN0ZXA7XG4gICAgICAgIGlmIChjb2RlICYgMikgZGVsdGEgKz0gc3RlcCA+PiAxO1xuICAgICAgICBpZiAoY29kZSAmIDEpIGRlbHRhICs9IHN0ZXAgPj4gMjtcbiAgICAgICAgZGVsdGEgKz0gc3RlcCA+PiAzO1xuICAgICAgICAvLyBjb21wdXRlIG5leHQgaW5kZXhcbiAgICAgICAgdGhpcy5pbmRleCArPSBTb3VuZERlY29kZXIuaW5kZXhUYWJsZVtjb2RlXTtcbiAgICAgICAgaWYgKHRoaXMuaW5kZXggPiA4OCkgdGhpcy5pbmRleCA9IDg4O1xuICAgICAgICBpZiAodGhpcy5pbmRleCA8IDApIHRoaXMuaW5kZXggPSAwO1xuICAgICAgICAvLyBjb21wdXRlIGFuZCBvdXRwdXQgc2FtcGxlXG4gICAgICAgIHRoaXMuc2FtcGxlICs9IGNvZGUgJiA4ID8gLWRlbHRhIDogZGVsdGE7XG4gICAgICAgIGlmICh0aGlzLnNhbXBsZSA+IDMyNzY3KSB0aGlzLnNhbXBsZSA9IDMyNzY3O1xuICAgICAgICBpZiAodGhpcy5zYW1wbGUgPCAtMzI3NjgpIHRoaXMuc2FtcGxlID0gLTMyNzY4O1xuICAgICAgICByZXR1cm4gdGhpcy5zYW1wbGU7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFNvdW5kRGVjb2RlcjtcbiIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuLy8gV0FWRmlsZS5qc1xuLy8gVXRpbGl0eSBjbGFzcyBmb3IgcmVhZGluZyBhbmQgZGVjb2RpbmcgV0FWIGZpbGUgbWV0YWRhdGFcbi8vIEJhc2VkIGRpcmVjdGx5IG9uIEpvaG4gTWFsb25leSdzIEFTIHZlcnNpb24gZm9yIHRoZSBTY3JhdGNoIEZsYXNoIFBsYXllclxuXG52YXIgT2Zmc2V0QnVmZmVyID0gcmVxdWlyZSgnLi4vdXRpbC9PZmZzZXRCdWZmZXInKTtcblxudmFyIFdBVkZpbGUgPSBmdW5jdGlvbigpIHt9O1xuXG5XQVZGaWxlLmRlY29kZSA9IGZ1bmN0aW9uKHdhdmVEYXRhKSB7XG4gICAgLy8gRGVjb2RlIHRoZSBnaXZlbiBXQVYgZmlsZSBkYXRhIGFuZCByZXR1cm4gYW4gT2JqZWN0IHdpdGggdGhlIGZvcm1hdCBhbmQgc2FtcGxlIGRhdGEuXG4gICAgdmFyIHJlc3VsdCA9IHt9O1xuXG4gICAgdmFyIGRhdGEgPSBuZXcgT2Zmc2V0QnVmZmVyKHdhdmVEYXRhKTtcblxuICAgIC8vIHJlYWQgV0FWRSBGaWxlIEhlYWRlclxuICAgIGlmIChkYXRhLnJlYWRTdHJpbmcoNCkgIT0gJ1JJRkYnKSB7IGNvbnNvbGUubG9nKFwiV0FWRmlsZTogIGJhZCBmaWxlIGhlYWRlclwiKTsgcmV0dXJuOyB9XG4gICAgdmFyIHRvdGFsU2l6ZSA9IGRhdGEucmVhZEludCgpO1xuICAgIGlmIChkYXRhLmdldExlbmd0aCgpICE9ICh0b3RhbFNpemUgKyA4KSkgY29uc29sZS5sb2coXCJXQVZGaWxlOiBiYWQgUklGRiBzaXplOyBpZ25vcmluZ1wiKTtcbiAgICBpZiAoZGF0YS5yZWFkU3RyaW5nKDQpICE9ICdXQVZFJykgeyBjb25zb2xlLmxvZyhcIldBVkZpbGU6IG5vdCBhIFdBVkUgZmlsZVwiKTsgcmV0dXJuOyB9XG5cbiAgICAvLyByZWFkIGZvcm1hdCBjaHVua1xuICAgIHZhciBmb3JtYXRDaHVuayA9IFdBVkZpbGUuZXh0cmFjdENodW5rKCdmbXQgJywgZGF0YSk7XG4gICAgaWYgKGZvcm1hdENodW5rLmdldExlbmd0aCgpIDwgMTYpIHsgY29uc29sZS5sb2coXCJXQVZGaWxlOiBmb3JtYXQgY2h1bmsgaXMgdG9vIHNtYWxsXCIpOyByZXR1cm47IH1cblxuICAgIHZhciBlbmNvZGluZyA9IGZvcm1hdENodW5rLnJlYWRTaG9ydCgpO1xuICAgIHJlc3VsdC5lbmNvZGluZyA9IGVuY29kaW5nO1xuICAgIHJlc3VsdC5jaGFubmVscyA9IGZvcm1hdENodW5rLnJlYWRTaG9ydCgpO1xuICAgIHJlc3VsdC5zYW1wbGVzUGVyU2Vjb25kID0gZm9ybWF0Q2h1bmsucmVhZEludCgpO1xuICAgIHJlc3VsdC5ieXRlc1BlclNlY29uZCA9IGZvcm1hdENodW5rLnJlYWRJbnQoKTtcbiAgICByZXN1bHQuYmxvY2tBbGlnbm1lbnQgPSBmb3JtYXRDaHVuay5yZWFkU2hvcnQoKTtcbiAgICByZXN1bHQuYml0c1BlclNhbXBsZSA9IGZvcm1hdENodW5rLnJlYWRTaG9ydCgpO1xuXG4gICAgLy8gZ2V0IHNpemUgb2YgZGF0YSBjaHVua1xuICAgIHZhciBzYW1wbGVEYXRhU3RhcnRBbmRTaXplID0gV0FWRmlsZS5kYXRhQ2h1bmtTdGFydEFuZFNpemUoZGF0YSk7XG4gICAgcmVzdWx0LnNhbXBsZURhdGFTdGFydCA9IHNhbXBsZURhdGFTdGFydEFuZFNpemVbMF07XG4gICAgcmVzdWx0LnNhbXBsZURhdGFTaXplID0gc2FtcGxlRGF0YVN0YXJ0QW5kU2l6ZVsxXTtcblxuICAgIC8vIGhhbmRsZSB2YXJpb3VzIGVuY29kaW5nc1xuICAgIGlmIChlbmNvZGluZyA9PSAxKSB7XG4gICAgICAgIGlmICghKChyZXN1bHQuYml0c1BlclNhbXBsZSA9PSA4KSB8fCAocmVzdWx0LmJpdHNQZXJTYW1wbGUgPT0gMTYpKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJXQVZGaWxlOiBjYW4gb25seSBoYW5kbGUgOC1iaXQgb3IgMTYtYml0IHVuY29tcHJlc3NlZCBQQ00gZGF0YVwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHQuc2FtcGxlQ291bnQgPSByZXN1bHQuc2FtcGxlRGF0YVNpemUgLyAyO1xuICAgIH0gZWxzZSBpZiAoZW5jb2RpbmcgPT0gMTcpIHtcbiAgICAgICAgaWYgKGZvcm1hdENodW5rLmxlbmd0aCA8IDIwKSB7IGNvbnNvbGUubG9nKFwiV0FWRmlsZTogYWRwY20gZm9ybWF0IGNodW5rIGlzIHRvbyBzbWFsbFwiKTsgcmV0dXJuOyB9XG4gICAgICAgIGlmIChyZXN1bHQuY2hhbm5lbHMgIT0gMSkgeyBjb25zb2xlLmxvZyhcIldBVkZpbGU6IGFkcGNtIHN1cHBvcnRzIG9ubHkgb25lIGNoYW5uZWwgKG1vbm9waG9uaWMpXCIpOyByZXR1cm47IH1cbiAgICAgICAgZm9ybWF0Q2h1bmsub2Zmc2V0ICs9IDI7ICAvLyBza2lwIGV4dHJhIGhlYWRlciBieXRlIGNvdW50XG4gICAgICAgIHZhciBzYW1wbGVzUGVyQmxvY2sgPSBmb3JtYXRDaHVuay5yZWFkU2hvcnQoKTtcbiAgICAgICAgcmVzdWx0LmFkcGNtQmxvY2tTaXplID0gKChzYW1wbGVzUGVyQmxvY2sgLSAxKSAvIDIpICsgNDsgLy8gYmxvY2sgc2l6ZSBpbiBieXRlc1xuICAgICAgICB2YXIgZmFjdENodW5rID0gV0FWRmlsZS5leHRyYWN0Q2h1bmsoJ2ZhY3QnLCBkYXRhKTtcbiAgICAgICAgaWYgKChmYWN0Q2h1bmsgIT0gbnVsbCkgJiYgKGZhY3RDaHVuay5nZXRMZW5ndGgoKSA9PSA0KSkge1xuICAgICAgICAgICAgcmVzdWx0LnNhbXBsZUNvdW50ID0gZmFjdENodW5rLnJlYWRJbnQoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHRoaXMgc2hvdWxkIG5ldmVyIGhhcHBlbiwgc2luY2UgdGhlcmUgc2hvdWxkIGFsd2F5cyBiZSBhICdmYWN0JyBjaHVua1xuICAgICAgICAgICAgLy8gc2xpZ2h0IG92ZXItZXN0aW1hdGUgKGRvZXNuJ3QgdGFrZSBBRFBDTSBoZWFkZXJzIGludG8gYWNjb3VudClcbiAgICAgICAgICAgIHJlc3VsdC5zYW1wbGVDb3VudCA9IDIgKiByZXN1bHQuc2FtcGxlRGF0YVNpemU7XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZyhcIldBVkZpbGU6IHVua25vd24gZW5jb2RpbmcgXCIgKyBlbmNvZGluZyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cbldBVkZpbGUuZXh0cmFjdENodW5rID0gZnVuY3Rpb24oZGVzaXJlZFR5cGUsIGRhdGEpIHtcbiAgICAvLyBSZXR1cm4gdGhlIGNvbnRlbnRzIG9mIHRoZSBmaXJzdCBjaHVuayBvZiB0aGUgZ2l2ZW4gdHlwZSBvciBhbiBlbXB0eSBPZmZzZXRCdWZmZXIgaWYgaXQgaXMgbm90IGZvdW5kLlxuICAgIGRhdGEub2Zmc2V0ID0gMTI7XG4gICAgd2hpbGUgKGRhdGEuYnl0ZXNBdmFpbGFibGUoKSA+IDgpIHtcbiAgICAgICAgdmFyIGNodW5rVHlwZSA9IGRhdGEucmVhZFN0cmluZyg0KTtcbiAgICAgICAgdmFyIGNodW5rU2l6ZSA9IGRhdGEucmVhZFVpbnQoKTtcbiAgICAgICAgaWYgKGNodW5rVHlwZSA9PSBkZXNpcmVkVHlwZSkge1xuICAgICAgICAgICAgaWYgKGNodW5rU2l6ZSA+IGRhdGEuYnl0ZXNBdmFpbGFibGUoKSkgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gbmV3IE9mZnNldEJ1ZmZlcihkYXRhLnJlYWRCeXRlcyhjaHVua1NpemUpKTtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkYXRhLm9mZnNldCArPSBjaHVua1NpemU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG5ldyBPZmZzZXRCdWZmZXIobmV3IEFycmF5QnVmZmVyKCkpO1xufTtcblxuV0FWRmlsZS5kYXRhQ2h1bmtTdGFydEFuZFNpemUgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgLy8gUmV0dXJuIGFuIGFycmF5IHdpdGggdGhlIHN0YXJ0aW5nIG9mZnNldCBhbmQgc2l6ZSBvZiB0aGUgZmlyc3QgY2h1bmsgb2YgdGhlIGdpdmVuIHR5cGUuXG4gICAgZGF0YS5vZmZzZXQgPSAxMjtcbiAgICB3aGlsZSAoZGF0YS5ieXRlc0F2YWlsYWJsZSgpID49IDgpIHtcbiAgICAgICAgdmFyIGNodW5rVHlwZSA9IGRhdGEucmVhZFN0cmluZyg0KTtcbiAgICAgICAgdmFyIGNodW5rU2l6ZSA9IGRhdGEucmVhZFVpbnQoKTtcbiAgICAgICAgaWYgKGNodW5rVHlwZSA9PSAnZGF0YScpIHtcbiAgICAgICAgICAgIGlmIChjaHVua1NpemUgPiBkYXRhLmJ5dGVzQXZhaWxhYmxlKCkpIHJldHVybiBbMCwgMF07IC8vIGJhZCB3YXZlIGZpbGVcbiAgICAgICAgICAgIHJldHVybiBbZGF0YS5vZmZzZXQsIGNodW5rU2l6ZV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkYXRhLm9mZnNldCArPSBjaHVua1NpemU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIFswLCAwXTsgLy8gY2h1bmsgbm90IGZvdW5kOyBiYWQgd2F2ZSBmaWxlXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdBVkZpbGU7XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDIwMTMgTWFzc2FjaHVzZXR0cyBJbnN0aXR1dGUgb2YgVGVjaG5vbG9neVxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOyB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3Jcbi8vIG1vZGlmeSBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIHZlcnNpb24gMixcbi8vIGFzIHB1Ymxpc2hlZCBieSB0aGUgRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uLlxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuLy8gYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2Zcbi8vIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbi8vIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGZvciBtb3JlIGRldGFpbHMuXG4vL1xuLy8gWW91IHNob3VsZCBoYXZlIHJlY2VpdmVkIGEgY29weSBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2Vcbi8vIGFsb25nIHdpdGggdGhpcyBwcm9ncmFtOyBpZiBub3QsIHdyaXRlIHRvIHRoZSBGcmVlIFNvZnR3YXJlXG4vLyBGb3VuZGF0aW9uLCBJbmMuLCA1MSBGcmFua2xpbiBTdHJlZXQsIEZpZnRoIEZsb29yLCBCb3N0b24sIE1BICAwMjExMC0xMzAxLCBVU0EuXG5cbi8vIFNjcmF0Y2ggSFRNTDUgUGxheWVyXG4vLyBDb2xvci5qc1xuLy8gQmFzZWQgb24gdGhlIG9yaWdpbmFsIGJ5IEpvaG4gTWFsb25leVxuXG5Db2xvciA9IGZ1bmN0aW9uKCkge307XG5cbkNvbG9yLmZyb21IU1YgPSBmdW5jdGlvbihoLCBzLCB2KSB7XG4gICAgdmFyIHIsIGcsIGI7XG4gICAgaCA9IGggJSAzNjA7XG4gICAgaWYgKGggPCAwKSBoICs9IDM2MDtcbiAgICBzID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ocywgMSkpO1xuICAgIHYgPSBNYXRoLm1heCgwLCBNYXRoLm1pbih2LCAxKSk7XG5cbiAgICB2YXIgaSA9IE1hdGguZmxvb3IoaCAvIDYwKTtcbiAgICB2YXIgZiA9IChoIC8gNjApIC0gaTtcbiAgICB2YXIgcCA9IHYgKiAoMSAtIHMpO1xuICAgIHZhciBxID0gdiAqICgxIC0gcyAqIGYpO1xuICAgIHZhciB0ID0gdiAqICgxIC0gcyAqICgxIC0gZikpO1xuICAgIGlmIChpID09IDApIHsgciA9IHY7IGcgPSB0OyBiID0gcDsgfVxuICAgIGVsc2UgaWYgKGkgPT0gMSkgeyByID0gcTsgZyA9IHY7IGIgPSBwOyB9XG4gICAgZWxzZSBpZiAoaSA9PSAyKSB7IHIgPSBwOyBnID0gdjsgYiA9IHQ7IH1cbiAgICBlbHNlIGlmIChpID09IDMpIHsgciA9IHA7IGcgPSBxOyBiID0gdjsgfVxuICAgIGVsc2UgaWYgKGkgPT0gNCkgeyByID0gdDsgZyA9IHA7IGIgPSB2OyB9XG4gICAgZWxzZSBpZiAoaSA9PSA1KSB7IHIgPSB2OyBnID0gcDsgYiA9IHE7IH1cbiAgICByID0gTWF0aC5mbG9vcihyICogMjU1KTtcbiAgICBnID0gTWF0aC5mbG9vcihnICogMjU1KTtcbiAgICBiID0gTWF0aC5mbG9vcihiICogMjU1KTtcbiAgICByZXR1cm4gKHIgPDwgMTYpIHwgKGcgPDwgOCkgfCBiO1xufTtcblxuQ29sb3IucmdiMmhzdiA9IGZ1bmN0aW9uKHJnYikge1xuICAgIHZhciBoLCBzLCB2LCB4LCBmLCBpO1xuICAgIHZhciByID0gKChyZ2IgPj4gMTYpICYgMjU1KSAvIDI1NTtcbiAgICB2YXIgZyA9ICgocmdiID4+IDgpICYgMjU1KSAvIDI1NTtcbiAgICB2YXIgYiA9IChyZ2IgJiAyNTUpIC8gMjU1O1xuICAgIHggPSBNYXRoLm1pbihNYXRoLm1pbihyLCBnKSwgYik7XG4gICAgdiA9IE1hdGgubWF4KE1hdGgubWF4KHIsIGcpLCBiKTtcbiAgICBpZiAoeCA9PSB2KSByZXR1cm4gWzAsIDAsIHZdOyAvLyBncmF5OyBodWUgYXJiaXRyYXJpbHkgcmVwb3J0ZWQgYXMgemVyb1xuICAgIGYgPSByID09IHggPyBnIC0gYiA6IGcgPT0geCA/IGIgLSByIDogciAtIGc7XG4gICAgaSA9IHIgPT0geCA/IDMgOiBnID09IHggPyA1IDogMTtcbiAgICBoID0gKChpIC0gZiAvICh2IC0geCkpICogNjApICUgMzYwO1xuICAgIHMgPSAodiAtIHgpIC8gdjtcbiAgICByZXR1cm4gW2gsIHMsIHZdO1xufTtcblxuQ29sb3Iuc2NhbGVCcmlnaHRuZXNzID0gZnVuY3Rpb24ocmdiLCBzY2FsZSkge1xuICAgIHZhciBoc3YgPSBDb2xvci5yZ2IyaHN2KHJnYik7XG4gICAgc2NhbGUgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihzY2FsZSwgMSkpO1xuICAgIHJldHVybiBDb2xvci5mcm9tSFNWKGhzdlswXSwgaHN2WzFdLCBzY2FsZSAqIGhzdlsyXSk7XG59O1xuXG5Db2xvci5taXhSR0IgPSBmdW5jdGlvbihyZ2IxLCByZ2IyLCBmcmFjdGlvbikge1xuICAgIC8vIE1peCByZ2IxIHdpdGggcmdiMi4gMCBnaXZlcyBhbGwgcmdiMSwgMSBnaXZlcyByYmcyLCAuNSBtaXhlcyB0aGVtIDUwLzUwLlxuICAgIGlmIChmcmFjdGlvbiA8PSAwKSByZXR1cm4gcmdiMTtcbiAgICBpZiAoZnJhY3Rpb24gPj0gMSkgcmV0dXJuIHJnYjI7XG4gICAgdmFyIHIxID0gKHJnYjEgPj4gMTYpICYgMjU1O1xuICAgIHZhciBnMSA9IChyZ2IxID4+IDgpICYgMjU1O1xuICAgIHZhciBiMSA9IHJnYjEgJiAyNTVcbiAgICB2YXIgcjIgPSAocmdiMiA+PiAxNikgJiAyNTU7XG4gICAgdmFyIGcyID0gKHJnYjIgPj4gOCkgJiAyNTU7XG4gICAgdmFyIGIyID0gcmdiMiAmIDI1NVxuICAgIHZhciByID0gKChmcmFjdGlvbiAqIHIyKSArICgoMS4wIC0gZnJhY3Rpb24pICogcjEpKSAmIDI1NTtcbiAgICB2YXIgZyA9ICgoZnJhY3Rpb24gKiBnMikgKyAoKDEuMCAtIGZyYWN0aW9uKSAqIGcxKSkgJiAyNTU7XG4gICAgdmFyIGIgPSAoKGZyYWN0aW9uICogYjIpICsgKCgxLjAgLSBmcmFjdGlvbikgKiBiMSkpICYgMjU1O1xuICAgIHJldHVybiAociA8PCAxNikgfCAoZyA8PCA4KSB8IGI7XG59O1xuXG5Db2xvci5yYW5kb20gPSBmdW5jdGlvbigpIHtcbiAgICAvLyByZXR1cm4gYSByYW5kb20gY29sb3JcbiAgICB2YXIgaCA9IDM2MCAqIE1hdGgucmFuZG9tKCk7XG4gICAgdmFyIHMgPSAwLjcgKyAoMC4zICogTWF0aC5yYW5kb20oKSk7XG4gICAgdmFyIHYgPSAwLjYgKyAoMC40ICogTWF0aC5yYW5kb20oKSk7XG4gICAgcmV0dXJuIENvbG9yLmZyb21IU1YoaCwgcywgdik7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvbG9yO1xuIiwiLy8gQ29weXJpZ2h0IChDKSAyMDEzIE1hc3NhY2h1c2V0dHMgSW5zdGl0dXRlIG9mIFRlY2hub2xvZ3lcbi8vXG4vLyBUaGlzIHByb2dyYW0gaXMgZnJlZSBzb2Z0d2FyZTsgeW91IGNhbiByZWRpc3RyaWJ1dGUgaXQgYW5kL29yXG4vLyBtb2RpZnkgaXQgdW5kZXIgdGhlIHRlcm1zIG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZSB2ZXJzaW9uIDIsXG4vLyBhcyBwdWJsaXNoZWQgYnkgdGhlIEZyZWUgU29mdHdhcmUgRm91bmRhdGlvbi5cbi8vXG4vLyBUaGlzIHByb2dyYW0gaXMgZGlzdHJpYnV0ZWQgaW4gdGhlIGhvcGUgdGhhdCBpdCB3aWxsIGJlIHVzZWZ1bCxcbi8vIGJ1dCBXSVRIT1VUIEFOWSBXQVJSQU5UWTsgd2l0aG91dCBldmVuIHRoZSBpbXBsaWVkIHdhcnJhbnR5IG9mXG4vLyBNRVJDSEFOVEFCSUxJVFkgb3IgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UuICBTZWUgdGhlXG4vLyBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZSBmb3IgbW9yZSBkZXRhaWxzLlxuLy9cbi8vIFlvdSBzaG91bGQgaGF2ZSByZWNlaXZlZCBhIGNvcHkgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlXG4vLyBhbG9uZyB3aXRoIHRoaXMgcHJvZ3JhbTsgaWYgbm90LCB3cml0ZSB0byB0aGUgRnJlZSBTb2Z0d2FyZVxuLy8gRm91bmRhdGlvbiwgSW5jLiwgNTEgRnJhbmtsaW4gU3RyZWV0LCBGaWZ0aCBGbG9vciwgQm9zdG9uLCBNQSAgMDIxMTAtMTMwMSwgVVNBLlxuXG4vLyBQcm92aWRlcyB0aGUgZXF1aXZhbGVudCBmdW5jdGlvbmFsaXR5IG9mIGFuIEFTIEJ5dGVBcnJheVxuLy8gdXNpbmcgSmF2YVNjcmlwdCBBcnJheUJ1ZmZlcnMgYW5kIHZpZXdlcnNcblxudmFyIE9mZnNldEJ1ZmZlciA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB0aGlzLm9mZnNldCA9IDA7XG4gICAgdGhpcy5hYiA9IGRhdGE7XG59O1xuXG4vLyBSZWFkIHZhcmlvdXMgZGF0YXR5cGVzIGZyb20gdGhlIEFycmF5QnVmZmVyLCBzZWVraW5nIHRoZSBvZmZzZXQuXG5PZmZzZXRCdWZmZXIucHJvdG90eXBlLnJlYWRTdHJpbmcgPSBmdW5jdGlvbihsZW5ndGgpIHtcbiAgICB2YXIgc3RyID0gdGhpcy5hYjJzdHIodGhpcy5hYi5zbGljZSh0aGlzLm9mZnNldCwgdGhpcy5vZmZzZXQgKyBsZW5ndGgpKTtcbiAgICB0aGlzLm9mZnNldCArPSBsZW5ndGg7XG4gICAgcmV0dXJuIHN0cjtcbn07XG5cbk9mZnNldEJ1ZmZlci5wcm90b3R5cGUucmVhZEludCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBudW0gPSB0aGlzLmFiMmludCh0aGlzLmFiLnNsaWNlKHRoaXMub2Zmc2V0LCB0aGlzLm9mZnNldCArIDQpKTtcbiAgICB0aGlzLm9mZnNldCArPSA0O1xuICAgIHJldHVybiBudW07XG59O1xuXG5PZmZzZXRCdWZmZXIucHJvdG90eXBlLnJlYWRVaW50ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG51bSA9IHRoaXMuYWIydWludCh0aGlzLmFiLnNsaWNlKHRoaXMub2Zmc2V0LCB0aGlzLm9mZnNldCArIDQpKTtcbiAgICB0aGlzLm9mZnNldCArPSA0O1xuICAgIHJldHVybiBudW07XG59O1xuXG5PZmZzZXRCdWZmZXIucHJvdG90eXBlLnJlYWRTaG9ydCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBudW0gPSB0aGlzLmFiMnNob3J0KHRoaXMuYWIuc2xpY2UodGhpcy5vZmZzZXQsIHRoaXMub2Zmc2V0ICsgMikpO1xuICAgIHRoaXMub2Zmc2V0ICs9IDI7XG4gICAgcmV0dXJuIG51bTtcbn07XG5cbk9mZnNldEJ1ZmZlci5wcm90b3R5cGUucmVhZEJ5dGVzID0gZnVuY3Rpb24obGVuZ3RoKSB7XG4gICAgdmFyIGJ5dGVzID0gdGhpcy5hYi5zbGljZSh0aGlzLm9mZnNldCwgdGhpcy5vZmZzZXQgKyBsZW5ndGgpO1xuICAgIHRoaXMub2Zmc2V0ICs9IGxlbmd0aDtcbiAgICByZXR1cm4gYnl0ZXM7XG59O1xuXG4vLyBMZW5ndGggb2YgdGhlIGludGVybmFsIGJ1ZmZlclxuT2Zmc2V0QnVmZmVyLnByb3RvdHlwZS5nZXRMZW5ndGggPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5hYi5ieXRlTGVuZ3RoO1xufTtcblxuLy8gTnVtYmVyIG9mIGJ5dGVzIHJlbWFpbmluZyBmcm9tIHRoZSBjdXJyZW50IG9mZnNldFxuT2Zmc2V0QnVmZmVyLnByb3RvdHlwZS5ieXRlc0F2YWlsYWJsZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldExlbmd0aCgpIC0gdGhpcy5vZmZzZXQ7XG59O1xuXG4vLyBBcnJheUJ1ZmZlciAtPiBKUyB0eXBlIGNvbnZlcnNpb24gbWV0aG9kc1xuT2Zmc2V0QnVmZmVyLnByb3RvdHlwZS5hYjJzdHIgPSBmdW5jdGlvbihidWYpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBuZXcgVWludDhBcnJheShidWYpKTtcbn07XG5cbi8vIFRoZXNlIGNyZWF0ZSBKYXZhc2NyaXB0IE51bWJlcnNcbk9mZnNldEJ1ZmZlci5wcm90b3R5cGUuYWIyaW50ID0gZnVuY3Rpb24oYnVmKSB7XG4gICAgcmV0dXJuIG5ldyBJbnQzMkFycmF5KGJ1ZilbMF07XG59O1xuXG5PZmZzZXRCdWZmZXIucHJvdG90eXBlLmFiMnVpbnQgPSBmdW5jdGlvbihidWYpIHtcbiAgICByZXR1cm4gbmV3IFVpbnQzMkFycmF5KGJ1ZilbMF07XG59O1xuXG5PZmZzZXRCdWZmZXIucHJvdG90eXBlLmFiMnNob3J0ID0gZnVuY3Rpb24oYnVmKSB7XG4gICAgcmV0dXJuIG5ldyBJbnQxNkFycmF5KGJ1ZilbMF07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IE9mZnNldEJ1ZmZlcjtcbiIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxudmFyIFBvaW50ID0gZnVuY3Rpb24oeCwgeSkge1xuICAgIHRoaXMueCA9IHg7XG4gICAgdGhpcy55ID0geTtcbn07XG5cbnZhciBSZWN0YW5nbGUgPSBmdW5jdGlvbih4LCB5LCB3aWR0aCwgaGVpZ2h0KSB7XG4gICAgdGhpcy54ID0geDtcbiAgICB0aGlzLnkgPSB5O1xuICAgIHRoaXMud2lkdGggPSB3aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcbiAgICB0aGlzLmxlZnQgPSB4O1xuICAgIHRoaXMucmlnaHQgPSB4ICsgd2lkdGg7XG4gICAgdGhpcy50b3AgPSB5O1xuICAgIHRoaXMuYm90dG9tID0geSArIGhlaWdodDtcbn07XG5cblJlY3RhbmdsZS5wcm90b3R5cGUuaW50ZXJzZWN0cyA9IGZ1bmN0aW9uKG90aGVyKSB7XG4gICAgcmV0dXJuICEodGhpcy5sZWZ0ID4gb3RoZXIucmlnaHQgfHwgdGhpcy5yaWdodCA8IG90aGVyLmxlZnQgfHwgdGhpcy50b3AgPiBvdGhlci5ib3R0b20gfHwgdGhpcy5ib3R0b20gPCBvdGhlci50b3ApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBSZWN0YW5nbGU7XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDIwMTMgTWFzc2FjaHVzZXR0cyBJbnN0aXR1dGUgb2YgVGVjaG5vbG9neVxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBmcmVlIHNvZnR3YXJlOyB5b3UgY2FuIHJlZGlzdHJpYnV0ZSBpdCBhbmQvb3Jcbi8vIG1vZGlmeSBpdCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIHZlcnNpb24gMixcbi8vIGFzIHB1Ymxpc2hlZCBieSB0aGUgRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uLlxuLy9cbi8vIFRoaXMgcHJvZ3JhbSBpcyBkaXN0cmlidXRlZCBpbiB0aGUgaG9wZSB0aGF0IGl0IHdpbGwgYmUgdXNlZnVsLFxuLy8gYnV0IFdJVEhPVVQgQU5ZIFdBUlJBTlRZOyB3aXRob3V0IGV2ZW4gdGhlIGltcGxpZWQgd2FycmFudHkgb2Zcbi8vIE1FUkNIQU5UQUJJTElUWSBvciBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRS4gIFNlZSB0aGVcbi8vIEdOVSBHZW5lcmFsIFB1YmxpYyBMaWNlbnNlIGZvciBtb3JlIGRldGFpbHMuXG4vL1xuLy8gWW91IHNob3VsZCBoYXZlIHJlY2VpdmVkIGEgY29weSBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2Vcbi8vIGFsb25nIHdpdGggdGhpcyBwcm9ncmFtOyBpZiBub3QsIHdyaXRlIHRvIHRoZSBGcmVlIFNvZnR3YXJlXG4vLyBGb3VuZGF0aW9uLCBJbmMuLCA1MSBGcmFua2xpbiBTdHJlZXQsIEZpZnRoIEZsb29yLCBCb3N0b24sIE1BICAwMjExMC0xMzAxLCBVU0EuXG5cbi8qXG4qICBUaW1lciBmb3IgdGhlIGludGVycGV0ZXIgYW5kIHBlcmZvcm1hbmNlIHRlc3RpbmdcbiogIFRpbSBNaWNrZWwsIEp1bHkgMjAxMVxuKi9cbnZhciBUaW1lciA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB0cmlhbHMgPSBbXTtcbiAgICB2YXIgbGFzdF90cmlhbCA9IDA7XG4gICAgdmFyIHN0YXJ0X3RpbWUgPSAwO1xufTtcblxuVGltZXIucHJvdG90eXBlLnRpbWUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gRGF0ZS5ub3coKTtcbn07XG5cblRpbWVyLnByb3RvdHlwZS5zdGFydCA9IGZ1bmN0aW9uKCkge1xuICAgIHN0YXJ0X3RpbWUgPSB0aGlzLnRpbWUoKTtcbn07XG5cblRpbWVyLnByb3RvdHlwZS5zdG9wID0gZnVuY3Rpb24oKSB7XG4gICAgZW5kID0gdGhpcy50aW1lKCk7XG4gICAgbGFzdF90cmlhbCA9IGVuZCAtIHN0YXJ0X3RpbWU7XG4gICAgdHJpYWxzLnB1c2gobGFzdF90cmlhbCk7XG59O1xuXG5UaW1lci5wcm90b3R5cGUuY291bnQgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdHJpYWxzLmxlbmd0aDtcbn07XG5cblRpbWVyLnByb3RvdHlwZS5hdmVyYWdlID0gZnVuY3Rpb24oKSB7XG4gICAgc3VtID0gMDtcbiAgICBmb3IgKGkgPSAwOyBpIDwgdGhpcy5jb3VudCgpOyBpKyspIHtcbiAgICAgICAgc3VtICs9IHRyaWFsc1tpXTtcbiAgICB9XG4gICAgcmV0dXJuIHN1bSAvIHRoaXMuY291bnQoKTtcbn07XG5cblRpbWVyLnByb3RvdHlwZS5wcmludCA9IGZ1bmN0aW9uKGVsZW1lbnQpIHtcbiAgICB0ZXh0ID0gXCJUcmlhbDogXCIgKyBsYXN0X3RyaWFsICsgXCJtc1wiICtcbiAgICAgICAgICAgXCI8YnIgLz5cXG5UcmlhbHM6IFwiICsgdGhpcy5jb3VudCgpICsgXCIsIEF2ZzogXCIgKyB0aGlzLmF2ZXJhZ2UoKSArIFwibXNcIjtcbiAgICBpZiAoZWxlbWVudCkge1xuICAgICAgICAkKGVsZW1lbnQpLmh0bWwodGV4dCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5sb2codGV4dCk7XG4gICAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBUaW1lcjtcbiIsIi8vIENvcHlyaWdodCAoQykgMjAxMyBNYXNzYWNodXNldHRzIEluc3RpdHV0ZSBvZiBUZWNobm9sb2d5XG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vclxuLy8gbW9kaWZ5IGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgdmVyc2lvbiAyLFxuLy8gYXMgcHVibGlzaGVkIGJ5IHRoZSBGcmVlIFNvZnR3YXJlIEZvdW5kYXRpb24uXG4vL1xuLy8gVGhpcyBwcm9ncmFtIGlzIGRpc3RyaWJ1dGVkIGluIHRoZSBob3BlIHRoYXQgaXQgd2lsbCBiZSB1c2VmdWwsXG4vLyBidXQgV0lUSE9VVCBBTlkgV0FSUkFOVFk7IHdpdGhvdXQgZXZlbiB0aGUgaW1wbGllZCB3YXJyYW50eSBvZlxuLy8gTUVSQ0hBTlRBQklMSVRZIG9yIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFLiAgU2VlIHRoZVxuLy8gR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgZm9yIG1vcmUgZGV0YWlscy5cbi8vXG4vLyBZb3Ugc2hvdWxkIGhhdmUgcmVjZWl2ZWQgYSBjb3B5IG9mIHRoZSBHTlUgR2VuZXJhbCBQdWJsaWMgTGljZW5zZVxuLy8gYWxvbmcgd2l0aCB0aGlzIHByb2dyYW07IGlmIG5vdCwgd3JpdGUgdG8gdGhlIEZyZWUgU29mdHdhcmVcbi8vIEZvdW5kYXRpb24sIEluYy4sIDUxIEZyYW5rbGluIFN0cmVldCwgRmlmdGggRmxvb3IsIEJvc3RvbiwgTUEgIDAyMTEwLTEzMDEsIFVTQS5cblxuLy8gSW5zdHIuanNcbi8vIFRpbSBNaWNrZWwsIDIwMTNcbi8vIEJhc2VkIGVudGlyZWx5IG9uIHRoZSBBUyBieSBKb2huIE1hbG9uZXksIEFwcmlsIDIwMTJcbi8vXG4vLyBUaGlzIGNsYXNzIGludGVyYWN0cyB3aXRoIElPIHRvIGxvYWQgU2NyYXRjaCBpbnN0cnVtZW50cyBhbmQgZHJ1bXMuXG4vLyBUaGUgdmFyaWFibGUgJ3NhbXBsZXMnIGlzIGEgZGljdGlvbmFyeSBvZiBuYW1lZCBzb3VuZCBidWZmZXJzLlxuLy8gQ2FsbCBpbml0U2FtcGxlcygpIHRvIGluaXRpYWxpemUgJ3NhbXBsZXMnIGJlZm9yZSB1c2luZyAoZHVyaW5nIGxvYWQpLlxuLy9cbi8vIEFsbCBpbnN0cnVtZW50IGFuZCBkcnVtIHNhbXBsZXMgd2VyZSBjcmVhdGVkIGZvciBTY3JhdGNoIGJ5OlxuLy9cbi8vICAgICAgUGF1bCBNYWRkZW4sIHBhdWxtYXR0aGV3bWFkZGVuQHlhaG9vLmNvbVxuLy9cbi8vIFBhdWwgaXMgYW4gZXhjZWxsZW50IHNvdW5kIGRlc2lnbmVyIGFuZCB3ZSBhcHByZWNpYXRlIGFsbCB0aGUgZWZmb3J0XG4vLyBoZSBwdXQgaW50byB0aGlzIHByb2plY3QuXG5cbnZhciBJbnN0ciA9IGZ1bmN0aW9uKCkge31cblxuSW5zdHIuc2FtcGxlcyA9IHt9O1xuSW5zdHIud2F2c0xvYWRlZCA9IDA7XG5cbkluc3RyLndhdnMgPSB7XG4gICAgJ0Fjb3VzdGljR3VpdGFyX0YzJzogJ2luc3RydW1lbnRzL0Fjb3VzdGljR3VpdGFyX0YzXzIyay53YXYnLFxuICAgICdBY291c3RpY1BpYW5vX0FzMyc6ICdpbnN0cnVtZW50cy9BY291c3RpY1BpYW5vKDUpX0EjM18yMmsud2F2JyxcbiAgICAnQWNvdXN0aWNQaWFub19DNCc6ICdpbnN0cnVtZW50cy9BY291c3RpY1BpYW5vKDUpX0M0XzIyay53YXYnLFxuICAgICdBY291c3RpY1BpYW5vX0c0JzogJ2luc3RydW1lbnRzL0Fjb3VzdGljUGlhbm8oNSlfRzRfMjJrLndhdicsXG4gICAgJ0Fjb3VzdGljUGlhbm9fRjUnOiAnaW5zdHJ1bWVudHMvQWNvdXN0aWNQaWFubyg1KV9GNV8yMmsud2F2JyxcbiAgICAnQWNvdXN0aWNQaWFub19DNic6ICdpbnN0cnVtZW50cy9BY291c3RpY1BpYW5vKDUpX0M2XzIyay53YXYnLFxuICAgICdBY291c3RpY1BpYW5vX0RzNic6ICdpbnN0cnVtZW50cy9BY291c3RpY1BpYW5vKDUpX0QjNl8yMmsud2F2JyxcbiAgICAnQWNvdXN0aWNQaWFub19ENyc6ICdpbnN0cnVtZW50cy9BY291c3RpY1BpYW5vKDUpX0Q3XzIyay53YXYnLFxuICAgICdBbHRvU2F4X0EzJzogJ2luc3RydW1lbnRzL0FsdG9TYXhfQTNfMjJLLndhdicsXG4gICAgJ0FsdG9TYXhfQzYnOiAnaW5zdHJ1bWVudHMvQWx0b1NheCgzKV9DNl8yMmsud2F2JyxcbiAgICAnQmFzc29vbl9DMyc6ICdpbnN0cnVtZW50cy9CYXNzb29uX0MzXzIyay53YXYnLFxuICAgICdCYXNzVHJvbWJvbmVfQTJfMic6ICdpbnN0cnVtZW50cy9CYXNzVHJvbWJvbmVfQTIoMilfMjJrLndhdicsXG4gICAgJ0Jhc3NUcm9tYm9uZV9BMl8zJzogJ2luc3RydW1lbnRzL0Jhc3NUcm9tYm9uZV9BMigzKV8yMmsud2F2JyxcbiAgICAnQ2VsbG9fQzInOiAnaW5zdHJ1bWVudHMvQ2VsbG8oM2IpX0MyXzIyay53YXYnLFxuICAgICdDZWxsb19BczInOiAnaW5zdHJ1bWVudHMvQ2VsbG8oMylfQSMyXzIyay53YXYnLFxuICAgICdDaG9pcl9GMyc6ICdpbnN0cnVtZW50cy9DaG9pcig0KV9GM18yMmsud2F2JyxcbiAgICAnQ2hvaXJfRjQnOiAnaW5zdHJ1bWVudHMvQ2hvaXIoNClfRjRfMjJrLndhdicsXG4gICAgJ0Nob2lyX0Y1JzogJ2luc3RydW1lbnRzL0Nob2lyKDQpX0Y1XzIyay53YXYnLFxuICAgICdDbGFyaW5ldF9DNCc6ICdpbnN0cnVtZW50cy9DbGFyaW5ldF9DNF8yMmsud2F2JyxcbiAgICAnRWxlY3RyaWNCYXNzX0cxJzogJ2luc3RydW1lbnRzL0VsZWN0cmljQmFzcygyKV9HMV8yMmsud2F2JyxcbiAgICAnRWxlY3RyaWNHdWl0YXJfRjMnOiAnaW5zdHJ1bWVudHMvRWxlY3RyaWNHdWl0YXIoMilfRjMoMSlfMjJrLndhdicsXG4gICAgJ0VsZWN0cmljUGlhbm9fQzInOiAnaW5zdHJ1bWVudHMvRWxlY3RyaWNQaWFub19DMl8yMmsud2F2JyxcbiAgICAnRWxlY3RyaWNQaWFub19DNCc6ICdpbnN0cnVtZW50cy9FbGVjdHJpY1BpYW5vX0M0XzIyay53YXYnLFxuICAgICdFbmdsaXNoSG9ybl9ENCc6ICdpbnN0cnVtZW50cy9FbmdsaXNoSG9ybigxKV9ENF8yMmsud2F2JyxcbiAgICAnRW5nbGlzaEhvcm5fRjMnOiAnaW5zdHJ1bWVudHMvRW5nbGlzaEhvcm4oMSlfRjNfMjJrLndhdicsXG4gICAgJ0ZsdXRlX0I1XzEnOiAnaW5zdHJ1bWVudHMvRmx1dGUoMylfQjUoMSlfMjJrLndhdicsXG4gICAgJ0ZsdXRlX0I1XzInOiAnaW5zdHJ1bWVudHMvRmx1dGUoMylfQjUoMilfMjJrLndhdicsXG4gICAgJ01hcmltYmFfQzQnOiAnaW5zdHJ1bWVudHMvTWFyaW1iYV9DNF8yMmsud2F2JyxcbiAgICAnTXVzaWNCb3hfQzQnOiAnaW5zdHJ1bWVudHMvTXVzaWNCb3hfQzRfMjJrLndhdicsXG4gICAgJ09yZ2FuX0cyJzogJ2luc3RydW1lbnRzL09yZ2FuKDIpX0cyXzIyay53YXYnLFxuICAgICdQaXp6X0EzJzogJ2luc3RydW1lbnRzL1BpenooMilfQTNfMjJrLndhdicsXG4gICAgJ1BpenpfRTQnOiAnaW5zdHJ1bWVudHMvUGl6eigyKV9FNF8yMmsud2F2JyxcbiAgICAnUGl6el9HMic6ICdpbnN0cnVtZW50cy9QaXp6KDIpX0cyXzIyay53YXYnLFxuICAgICdTdGVlbERydW1fRDUnOiAnaW5zdHJ1bWVudHMvU3RlZWxEcnVtX0Q1XzIyay53YXYnLFxuICAgICdTeW50aExlYWRfQzQnOiAnaW5zdHJ1bWVudHMvU3ludGhMZWFkKDYpX0M0XzIyay53YXYnLFxuICAgICdTeW50aExlYWRfQzYnOiAnaW5zdHJ1bWVudHMvU3ludGhMZWFkKDYpX0M2XzIyay53YXYnLFxuICAgICdTeW50aFBhZF9BMyc6ICdpbnN0cnVtZW50cy9TeW50aFBhZCgyKV9BM18yMmsud2F2JyxcbiAgICAnU3ludGhQYWRfQzYnOiAnaW5zdHJ1bWVudHMvU3ludGhQYWQoMilfQzZfMjJrLndhdicsXG4gICAgJ1Rlbm9yU2F4X0MzJzogJ2luc3RydW1lbnRzL1Rlbm9yU2F4KDEpX0MzXzIyay53YXYnLFxuICAgICdUcm9tYm9uZV9CMyc6ICdpbnN0cnVtZW50cy9Ucm9tYm9uZV9CM18yMmsud2F2JyxcbiAgICAnVHJ1bXBldF9FNSc6ICdpbnN0cnVtZW50cy9UcnVtcGV0X0U1XzIyay53YXYnLFxuICAgICdWaWJyYXBob25lX0MzJzogJ2luc3RydW1lbnRzL1ZpYnJhcGhvbmVfQzNfMjJrLndhdicsXG4gICAgJ1Zpb2xpbl9ENCc6ICdpbnN0cnVtZW50cy9WaW9saW4oMilfRDRfMjJLLndhdicsXG4gICAgJ1Zpb2xpbl9BNCc6ICdpbnN0cnVtZW50cy9WaW9saW4oMylfQTRfMjJrLndhdicsXG4gICAgJ1Zpb2xpbl9FNSc6ICdpbnN0cnVtZW50cy9WaW9saW4oM2IpX0U1XzIyay53YXYnLFxuICAgICdXb29kZW5GbHV0ZV9DNSc6ICdpbnN0cnVtZW50cy9Xb29kZW5GbHV0ZV9DNV8yMmsud2F2JyxcbiAgICAvLyBEcnVtc1xuICAgICdCYXNzRHJ1bSc6ICdkcnVtcy9CYXNzRHJ1bSgxYilfMjJrLndhdicsXG4gICAgJ0JvbmdvJzogJ2RydW1zL0JvbmdvXzIyay53YXYnLFxuICAgICdDYWJhc2EnOiAnZHJ1bXMvQ2FiYXNhKDEpXzIyay53YXYnLFxuICAgICdDbGFwJzogJ2RydW1zL0NsYXAoMSlfMjJrLndhdicsXG4gICAgJ0NsYXZlcyc6ICdkcnVtcy9DbGF2ZXMoMSlfMjJrLndhdicsXG4gICAgJ0NvbmdhJzogJ2RydW1zL0NvbmdhKDEpXzIyay53YXYnLFxuICAgICdDb3diZWxsJzogJ2RydW1zL0Nvd2JlbGwoMylfMjJrLndhdicsXG4gICAgJ0NyYXNoJzogJ2RydW1zL0NyYXNoKDIpXzIyay53YXYnLFxuICAgICdDdWljYSc6ICdkcnVtcy9DdWljYSgyKV8yMmsud2F2JyxcbiAgICAnR3Vpcm9Mb25nJzogJ2RydW1zL0d1aXJvTG9uZygxKV8yMmsud2F2JyxcbiAgICAnR3Vpcm9TaG9ydCc6ICdkcnVtcy9HdWlyb1Nob3J0KDEpXzIyay53YXYnLFxuICAgICdIaUhhdENsb3NlZCc6ICdkcnVtcy9IaUhhdENsb3NlZCgxKV8yMmsud2F2JyxcbiAgICAnSGlIYXRPcGVuJzogJ2RydW1zL0hpSGF0T3BlbigyKV8yMmsud2F2JyxcbiAgICAnSGlIYXRQZWRhbCc6ICdkcnVtcy9IaUhhdFBlZGFsKDEpXzIyay53YXYnLFxuICAgICdNYXJhY2FzJzogJ2RydW1zL01hcmFjYXMoMSlfMjJrLndhdicsXG4gICAgJ1NpZGVTdGljayc6ICdkcnVtcy9TaWRlU3RpY2soMSlfMjJrLndhdicsXG4gICAgJ1NuYXJlRHJ1bSc6ICdkcnVtcy9TbmFyZURydW0oMSlfMjJrLndhdicsXG4gICAgJ1RhbWJvdXJpbmUnOiAnZHJ1bXMvVGFtYm91cmluZSgzKV8yMmsud2F2JyxcbiAgICAnVG9tJzogJ2RydW1zL1RvbSgxKV8yMmsud2F2JyxcbiAgICAnVHJpYW5nbGUnOiAnZHJ1bXMvVHJpYW5nbGUoMSlfMjJrLndhdicsXG4gICAgJ1ZpYnJhc2xhcCc6ICdkcnVtcy9WaWJyYXNsYXAoMSlfMjJrLndhdicsXG4gICAgJ1dvb2RCbG9jayc6ICdkcnVtcy9Xb29kQmxvY2soMSlfMjJrLndhdidcbn07XG5cbkluc3RyLndhdkNvdW50ID0gT2JqZWN0LmtleXMoSW5zdHIud2F2cykubGVuZ3RoO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEluc3RyO1xuIl19
(4)
});
