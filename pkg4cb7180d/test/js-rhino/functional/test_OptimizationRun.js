/**
 * Functional tests for the consolidation optimizer (Features 1 & 2 of the
 * Campus Energy Optimizer).
 *
 * Two concerns are covered:
 *
 *  1. The CURRENT persisted optimizer output honors the optimizer's hard
 *     guarantees — read-only assertions over the existing MoveRecommendations
 *     and BuildingHour grid (no mutation).
 *
 *  2. OptimizationRun#runOptimization run live with a restricted scenario
 *     ("after 5pm only") still produces valid, conflict-free output. This block
 *     mutates global state, so its afterAll restores the full-week default run
 *     the demo ships with.
 *
 * The key guarantee is "never create time conflicts": a section only moves into
 * a room that is free at its exact meeting day/time. We verify this directly by
 * grouping accepted moves by destination room and asserting no two relocated
 * sections sharing a destination room overlap on any shared weekday.
 */
const filename = 'test_OptimizationRun';

// Two sections conflict when they share at least one meeting weekday AND their
// [startMin, endMin) intervals overlap.
function sharesWeekday(daysA, daysB) {
  var a = daysA || '';
  var b = daysB || '';
  for (var i = 0; i < a.length; i = i + 1) {
    if (b.indexOf(a.charAt(i)) >= 0) {
      return true;
    }
  }
  return false;
}

function timesOverlap(a, b) {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

// Count destination-room collisions among a C3 array of accepted moves whose
// `section` (startMin/endMin/days) and `toRoom` have been included in the fetch.
function destinationRoomConflicts(moves) {
  var byRoom = {};
  moves.each((m) => {
    if (m.status !== 'accepted' || !m.toRoom) {
      return;
    }
    var key = m.toRoom.id;
    byRoom[key] = byRoom[key] || [];
    byRoom[key].push(m);
  });
  var conflicts = 0;
  Object.keys(byRoom).forEach((roomId) => {
    var group = byRoom[roomId];
    for (var i = 0; i < group.length; i = i + 1) {
      for (var j = i + 1; j < group.length; j = j + 1) {
        var sa = group[i].section;
        var sb = group[j].section;
        if (sa && sb && sharesWeekday(sa.days, sb.days) && timesOverlap(sa, sb)) {
          conflicts = conflicts + 1;
        }
      }
    }
  });
  return conflicts;
}

describe(filename, function () {
  beforeAll(function () {
    this.ctx = TestApi.createContext(filename);
  });

  afterAll(function () {
    TestApi.teardown(this.ctx);
  });

  describe('persisted optimizer output', function () {
    beforeAll(function () {
      this.stats = OptimizationRun.overviewStats();
      var moves = MoveRecommendation.fetch({
        include:
          'this, section.startMin, section.endMin, section.days, ' +
          'fromRoom.id, fromRoom.building.id, toRoom.id, toRoom.building.id',
        limit: -1,
      }).objs;

      this.moveCount = moves.length;
      this.conflicts = destinationRoomConflicts(moves);

      var sumFreedAccepted = 0;
      var sameRoom = 0;
      var sameBuilding = 0;
      var negativeFreed = 0;
      var invalidStatus = 0;
      var validStatuses = ['proposed', 'accepted', 'rejected'];
      moves.each((m) => {
        if (validStatuses.indexOf(m.status) < 0) {
          invalidStatus = invalidStatus + 1;
        }
        if ((m.buildingHoursFreed || 0) < 0) {
          negativeFreed = negativeFreed + 1;
        }
        if (m.fromRoom && m.toRoom && m.fromRoom.id === m.toRoom.id) {
          sameRoom = sameRoom + 1;
        }
        if (
          m.fromRoom &&
          m.toRoom &&
          m.fromRoom.building &&
          m.toRoom.building &&
          m.fromRoom.building.id === m.toRoom.building.id
        ) {
          sameBuilding = sameBuilding + 1;
        }
        if (m.status === 'accepted') {
          sumFreedAccepted = sumFreedAccepted + (m.buildingHoursFreed || 0);
        }
      });
      this.sumFreedAccepted = sumFreedAccepted;
      this.sameRoom = sameRoom;
      this.sameBuilding = sameBuilding;
      this.negativeFreed = negativeFreed;
      this.invalidStatus = invalidStatus;
    });

    it('has produced at least one relocation recommendation', function () {
      expect(this.moveCount).toBeGreaterThan(0);
    });

    it('relocates every section into a different room', function () {
      expect(this.sameRoom).toEqual(0);
    });

    it('only consolidates across buildings (origin building != destination)', function () {
      expect(this.sameBuilding).toEqual(0);
    });

    it('never reports a negative freed-building-hour count on a move', function () {
      expect(this.negativeFreed).toEqual(0);
    });

    it('only uses the valid move lifecycle statuses', function () {
      expect(this.invalidStatus).toEqual(0);
    });

    it('creates no time conflicts in any destination room', function () {
      expect(this.conflicts).toEqual(0);
    });

    it('attributes freed building-hours that sum to the reported weekly total', function () {
      expect(this.sumFreedAccepted).toEqual(this.stats.freedHoursPerWeek);
    });
  });

  describe('BuildingHour occupancy grid', function () {
    beforeAll(function () {
      this.stats = OptimizationRun.overviewStats();
      this.buildingCount = Building.fetchCount({});
      this.totalBuildingHours = BuildingHour.fetchCount({});
      this.emptyCurrent = BuildingHour.fetchCount({ filter: 'sectionsCurrent == 0' });
      this.emptyOptimized = BuildingHour.fetchCount({ filter: 'sectionsOptimized == 0' });
      this.negativeOptimized = BuildingHour.fetchCount({ filter: 'sectionsOptimized < 0' });
    });

    it('holds one row per building per weekday hour-block (buildings x 5 x 15)', function () {
      expect(this.totalBuildingHours).toEqual(this.buildingCount * 5 * 15);
    });

    it('never stores a negative optimized occupancy', function () {
      expect(this.negativeOptimized).toEqual(0);
    });

    it('matches overviewStats on baseline empty building-hours', function () {
      expect(this.emptyCurrent).toEqual(this.stats.emptyBefore);
    });

    it('matches overviewStats on optimized empty building-hours', function () {
      expect(this.emptyOptimized).toEqual(this.stats.emptyAfter);
    });
  });

  describe('#runOptimization with a restricted "after 5pm" scenario', function () {
    beforeAll(function () {
      // Mutates global state: re-runs the optimizer for hour blocks 17..21 only.
      OptimizationRun.runOptimization(17, 22, 2, ['M', 'T', 'W', 'R', 'F'], []);
      this.scenarioStats = OptimizationRun.overviewStats();
      this.scenarioMoves = MoveRecommendation.fetch({
        include:
          'this, section.startMin, section.endMin, section.days, ' +
          'fromRoom.building.id, toRoom.id, toRoom.building.id',
        limit: -1,
      }).objs;
      this.scenarioConflicts = destinationRoomConflicts(this.scenarioMoves);

      var crossBuildingViolations = 0;
      this.scenarioMoves.each((m) => {
        if (m.status !== 'accepted') {
          return;
        }
        if (
          !m.fromRoom ||
          !m.toRoom ||
          !m.fromRoom.building ||
          !m.toRoom.building ||
          m.fromRoom.building.id === m.toRoom.building.id
        ) {
          crossBuildingViolations = crossBuildingViolations + 1;
        }
      });
      this.crossBuildingViolations = crossBuildingViolations;
    });

    afterAll(function () {
      // Restore the demo's shipped full-week consolidation so the live app and
      // sibling suites see the default state again.
      OptimizationRun.runOptimization(7, 22, 2, ['M', 'T', 'W', 'R', 'F'], []);
    });

    it('does not reduce empty building-hours below the baseline', function () {
      expect(this.scenarioStats.emptyAfter).toBeGreaterThanOrEqual(this.scenarioStats.emptyBefore);
    });

    it('reports freed hours as exactly the empty-hour gain for the scenario', function () {
      expect(this.scenarioStats.freedHoursPerWeek).toEqual(
        this.scenarioStats.emptyAfter - this.scenarioStats.emptyBefore,
      );
    });

    it('produces only cross-building relocations in the scenario', function () {
      expect(this.crossBuildingViolations).toEqual(0);
    });

    it('creates no time conflicts in the scenario output', function () {
      expect(this.scenarioConflicts).toEqual(0);
    });
  });
});
