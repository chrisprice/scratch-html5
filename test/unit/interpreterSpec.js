/* jasmine specs for Interpreter.js go here */

var Interpreter = require('../../js/Interpreter'),
    Runtime = require('../../js/Runtime');

describe('Interpreter', function() {

    var interp;
    beforeEach(function() {
        interp = new Interpreter();
        global.runtime = new Runtime();
    });

    describe('TargetStage', function() {
        it('should return the target.stage object', function() {
            expect(interp.targetStage()).toEqual(runtime.stage);
        });
    });
});
