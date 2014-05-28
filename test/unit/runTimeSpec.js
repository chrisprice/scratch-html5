/* jasmine specs for Runtime.js go here */

var Interpreter = require('../../js/Interpreter'),
    Runtime = require('../../js/Runtime'),
    SoundPrims = require('../../js/primitives/SoundPrims'),
    Stage = require('../../js/Stage'),
    Sprite = require('../../js/Sprite'),
    IO = require('../../js/IO');

describe('Runtime', function() {

    beforeEach(function() {
        global.io = new IO();
        global.interp = new Interpreter();
        global.runtime = new Runtime();
    });

    describe('Stop All', function() {

        beforeEach(function() {
            runtime.stage = {
                resetFilters: function() {}
            };
            runtime.sprites = [new Sprite({})];

            spyOn(SoundPrims, "stopAllSounds");
            spyOn(runtime.sprites[0], "hideBubble").andReturn();
            spyOn(runtime.sprites[0], "resetFilters").andReturn();
            spyOn(runtime.sprites[0], "hideAsk").andReturn();
            spyOn(runtime.stage, "resetFilters");
        });

        it('should call a new Thread Object', function() {
            runtime.stopAll();
            expect(interp.activeThread).toEqual(new Interpreter.Thread(null));
        });

        it('should intitialize an empty threads array', function() {
            runtime.stopAll();
            expect(interp.threads).toEqual([]);
        });

        it('should call stopAllSounds', function() {
            runtime.stopAll();
            expect(SoundPrims.stopAllSounds).toHaveBeenCalled();
        });

        it('should call sprites.hideBubble', function() {
            runtime.stopAll();
            expect(runtime.sprites[0].hideBubble).toHaveBeenCalled();
        });

        it('should call sprites.resetFilters', function() {
            runtime.stopAll();
            expect(runtime.sprites[0].resetFilters).toHaveBeenCalled();
        });

        it('should call sprites.hideAsk', function() {
            runtime.stopAll();
            expect(runtime.sprites[0].hideAsk).toHaveBeenCalled();
        });

        it('should call stage.resetFilters', function() {
            runtime.stopAll();
            expect(runtime.stage.resetFilters).toHaveBeenCalled();
        });

    });

});
