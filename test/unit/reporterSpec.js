/* jasmine specs for Reporter.js go here */

var Reporter = require('../../js/Reporter'),
    IO = require('../../js/IO');

describe('Reporter', function() {

    var reporter;
    beforeEach(function() {
        global.io = new IO();
        reporter = new Reporter({});
    });

     describe('determineReporterLabel', function() {
        it('should return a stage variable', function() {
            reporter.target = "Stage";
            reporter.param = "myAnswer";
            reporter.cmd = "getVar:";
            expect(reporter.determineReporterLabel()).toBe('myAnswer');
        });

        it('should return a sprite variable', function() {
            reporter.target = "Sprite 1";
            reporter.param = "localAnswer";
            reporter.cmd = "getVar:";
            expect(reporter.determineReporterLabel()).toBe('Sprite 1: localAnswer');
        });

        it('should return a stage answer variable', function() {
            reporter.target = "Stage";
            reporter.param = null;
            reporter.cmd = "answer";
            expect(reporter.determineReporterLabel()).toBe('answer');
        });

    });
});
