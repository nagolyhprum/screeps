
var recommendations = [{
    count : groups => Math.min(hasSize(groups.harvester) + 1, getWorkerCount(groups)),
    type : miner,
    body : groups => makeBody(groups, [MOVE, WORK], [WORK], hasHalf(groups), 250)
}, {
    count : groups => Math.min(hasSize(groups.miner) + 1, getWorkerCount(groups)), 
    type : harvester,
    body : groups => makeBody(groups, [CARRY, MOVE], [CARRY, MOVE], hasHalf(groups), 300)
}, {
    count : getWorkerCount,
    type : upgrader,
    body : workerBody
}, {
    count : getWorkerCount,
    type : builder,
    body : workerBody
}, {
    count : getWorkerCount,
    type : fighter,
    body : fighterBody
}, {
    count : groups => {
        var exits = Game.map.describeExits(groups.room.name);
        return Object.keys(exits).map(key => exits[key]).filter(room => !Game.rooms[room]).length;
    },
    type : expander,
    body : () => [MOVE]
}];

module.exports.loop = function () {
    for(var name in Memory.creeps) {
        if(!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }
    var creeps = Object.keys(Game.creeps).reduce((creeps, key) => {
        creeps.push(Game.creeps[key]);
        return creeps;
    }, []);
    var now = new Date().getTime();
    var count = Number.POSITIVE_INFINITY;
    for(var i in Game.rooms) {
        var r = Game.rooms[i];
        count = room(r, creeps, now, count);
        addSites(r);
        r.find(FIND_CONSTRUCTION_SITES).forEach(cs => {
            if(cs.structureType === STRUCTURE_ROAD && !cs.progress) {
                var date = Memory.roads[cs.pos.x + cs.pos.y * 50] || 0;
                if(now - date >= 1000  * 60) {
                    cs.remove();
                }
            }
        });
    }
    for(var i in Game.spawns) {
        var spawn = Game.spawns[i];
        if(spawn.memory.toSpawn) {
            spawn.createCreep(spawn.memory.toSpawn.body, undefined, spawn.memory.toSpawn.memory);
            spawn.memory.toSpawn = false;
        }
    }
    console.log("--------");
};

//HELPERS

function hasHalf(groups) {
    var workers = getWorkerCount(groups) / 2;
    return hasSize(groups.miner) >= workers && hasSize(groups.harvester) >= workers;
}

function makeBody(groups, front, sequence, doit, max = BODYPART_COST.claim * MAX_CREEP_SIZE) {
    var cost = front.reduce((cost, part) => cost + BODYPART_COST[part], 0);
    var i = 0;
    while(doit && (cost += BODYPART_COST[sequence[i % sequence.length]]) <= groups.room.energyCapacityAvailable && cost <= max) {
        front.push(sequence[i % sequence.length]);
        i++;
    }
    for(var i = 0; i < front.length / 2; i++) {
        var temp = front[i];
        front[i] = front[front.length - i - 1];
        front[front.length - i - 1] = temp;
    }
    return front;
}

function getWorkerCount(groups) {
    return groups.room.find(FIND_SOURCES).reduce((spaces, source) => {
        var x = source.pos.x, y = source.pos.y;
        var area = groups.room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true).filter(terrain => terrain.terrain !== "wall");
        return area.length + spaces;
    }, 0) / 2;
}

function fighterBody(groups) {
    return makeBody(groups, [MOVE, ATTACK], [ATTACK, TOUGH, TOUGH], true, 330);
}

function workerBody(groups) {
    return makeBody(groups, [MOVE, CARRY, WORK], [MOVE, CARRY, WORK], true, 400);
}

function hasSize(r) {
    return r ? r.length : 0;
}

Memory.roads = Memory.roads || [];
function createPath(creep) {
    var x = creep.pos.x, y = creep.pos.y;
    creep.room.createConstructionSite(x, y, STRUCTURE_ROAD);
    Memory.roads[x + y * 50] = new Date().getTime();
}

function getDropped(creep) {
    createPath(creep);
    if(creep.carry.energy < creep.carryCapacity) {
        if(!goHome(creep)) {
            var droppedEnergy = creep.room.find(FIND_DROPPED_ENERGY).sort((a, b) => b.amount - a.amount);
            var goal = droppedEnergy.find(energy => energy.id === creep.memory.goal) || droppedEnergy[0];
            if(creep.pickup(goal) == ERR_NOT_IN_RANGE) {
                creep.moveTo(goal); 
                creep.memory.goal = goal.id; 
            } else {
                creep.memory.goal = false;
            }
        }
        return true;
    }
    return false;
}

function fight(creep) {
    requires(creep, [ATTACK, MOVE])
    var hostiles = [...creep.room.find(FIND_HOSTILE_STRUCTURES), ...creep.room.find(FIND_HOSTILE_CREEPS)];
    if(hostiles.length) {
        if(creep.attack(hostiles[0]) === ERR_NOT_IN_RANGE) {
           creep.moveTo(hostiles[0]); 
        }
        return true;
    }
    return false;
}

function squareFrom(x, y, callback) {
    var range = 1;
    while(true) {
        var range2 = 2 * range;
        for(var i = 0; i < range2; i++) { //top left to right
            if(callback(x - range + i, y - range)) {
                return;
            }
        }
        for(var i = 0; i < range2; i++) { //top left to bottom
            if(callback(x - range, y - range + i)) {
                return;
            }
        }
        for(var i = 0; i < range2; i++) { //top right to bottom
            if(callback(x + range, y - range + i)) {
                return;
            }
        }
        for(var i = 0; i < range2; i++) { //bottom left to right
            if(callback(x - range + i, y + range)) {
                return;
            }
        }
        range++;
    }
}

function switchStates(creep) {
    if(creep.memory.state && creep.carry.energy == 0) {
        creep.memory.state = false;
        creep.say('harvesting');
    } else if(!creep.memory.state && creep.carry.energy == creep.carryCapacity) {
        creep.memory.state = true;
        creep.say("working");
    }
    return creep.memory.state;
}

function addSite(room, site) {
    var cs = room.find(FIND_CONSTRUCTION_SITES);
    if(cs.length < MAX_CONSTRUCTION_SITES) {
        var max = CONTROLLER_STRUCTURES[site][room.controller ? room.controller.level : 0];
        var built = room.find(FIND_STRUCTURES, {
            filter : structure => structure.structureType === site 
        }).length;
        var toBuild = room.find(FIND_CONSTRUCTION_SITES, {
            filter : cs => cs.structureType === site
        }).length;
        if(built + toBuild < max) {
            squareFrom(25, 25, (x, y) => {
                var terrain = room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true);
                var hasWall = terrain.reduce((hasWall, terrain) => hasWall || terrain.terrain === "wall", false);
                var goodSpot = (x + y) % 2 === 1 && !hasWall;
                var result = goodSpot ? room.createConstructionSite(x, y, site) : false;
                return x === -1 && y === -1 || result === OK;
            });   
        }
    }
}

function addSites(room) {
    addSite(room, STRUCTURE_TOWER);
    addSite(room, STRUCTURE_EXTENSION);
}

function requires(creep, r) {
    var missing = r.reduce((all, part) => all || (!creep.body.find(p => p.type === part) ? part : false), false);
    if(missing) {
        //creep.suicide();
        creep.say(missing);
    }
}

function goHome(creep) {
    if(creep.room.name !== creep.memory.home) {
        var exits = Game.map.findRoute(creep.room.name, creep.memory.home);
        var path = creep.pos.findClosestByRange(exits[0].exit);
        creep.moveTo(path);   
        createPath(creep);
        return true;
    }
    return false;
}

//ROLES

function room(room, creeps, now, leastCreep) {
    var spawn = Game.spawns[Object.keys(Game.spawns).find(key => Game.spawns[key].room === room)] || Game.spawns[Object.keys(Game.spawns)[0]];
    var groups = creeps.filter(creep => creep.memory.home === room.name).reduce((groups, creep) => {
        var r = groups[creep.memory.type] = groups[creep.memory.type] || [];
        r.push(creep);
        return groups;
    }, {});
    var creepCount = Object.keys(groups).reduce((creepCount, key) => creepCount + groups[key].length || 0, 0);
    groups.now = now;
    groups.spawn = spawn;
    groups.room = room;
    console.log(Object.keys(groups).map(key => [key, groups[key].length]), creepCount)
    var free = creeps.filter(creep => !creep.memory.type);
    var canSpawn = true;
    recommendations.forEach(recommendation => {
        var type = recommendation.type.name, count = groups[type] ? groups[type].length : 0;
        if(count < recommendation.count(groups) && canSpawn && creepCount <= leastCreep) {
            if(free.length) {
                var creep = free.shift();
                creep.memory.type = type;
                creep.memory.home = room.name;
            } else {
                canSpawn = false;
                spawn.memory.toSpawn = {
                    body : recommendation.body(groups),
                    memory : {
                        type : type,
                        home : room.name
                    }
                };
            }
        }
        if(groups[type]) {
            groups[type].forEach(creep => recommendation.type(creep, groups));
        }
    });
    return Math.min(leastCreep, creepCount);
}

function harvester(creep, groups) {
    requires(creep, [CARRY, MOVE]);
    if(switchStates(creep)) {
        var targets = groups.spawn.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_EXTENSION || structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity;
            }
        }).sort((a, b) => a.energyCapacity - b.energyCapacity);
        if(targets.length > 0) {
            if(creep.transfer(targets[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                creep.moveTo(targets[0]);
            }
        }
    } else {
        getDropped(creep);
    }
}

function builder(creep, groups) {
    requires(creep, [WORK, CARRY, MOVE]);
    if(switchStates(creep)) {
        var targets = creep.room.find(FIND_STRUCTURES).sort((a, b) => (b.hitsMax - b.hits) - (a.hitsMax - a.hits));
        if(targets.length && targets[0].hits < targets[0].hitsMax) {
            if(creep.repair(targets[0]) == ERR_NOT_IN_RANGE) {
                creep.moveTo(targets[0]);
            }
        } else {
            var targets = creep.room.find(FIND_CONSTRUCTION_SITES).sort((a, b) => (b.progressTotal + b.progress) - (a.progressTotal + a.progress));
            if(targets.length) {
                if(creep.build(targets[0]) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(targets[0]);
                }
            } else {
                upgrader(creep, groups);
            }
        }
        
    } else {
        getDropped(creep);
    }
}

function upgrader(creep, groups) {
    requires(creep, [WORK, MOVE, CARRY]);
    if(switchStates(creep)) {
        var controller = groups.spawn.room.controller;
        if(creep.upgradeController(controller) == ERR_NOT_IN_RANGE) {
            creep.moveTo(controller);
        }
    } else {
        getDropped(creep);
    }
}

var five_minutes = 1000 * 60 * 5;

function fighter(creep, groups) {
    if(!fight(creep) && !goHome(creep)) {
        switch(Math.floor(groups.now / five_minutes) % 4) {
            case 0 :
                creep.moveTo(10, 10);
                break;
            case 1 :
                creep.moveTo(40, 10);
                break;
            case 2 :
                creep.moveTo(40, 40);
                break;
            case 3 :
                creep.moveTo(10, 40);
                break;
        }
    }
}

function miner(creep) {
    requires(creep, [WORK, MOVE]);
    if(!goHome(creep)) {
        var target = creep.pos.findClosestByPath(FIND_SOURCES);
        if(creep.harvest(target) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
    }
}

function expander(creep) {
    if(!creep.memory.goal) {
        var home = Game.rooms[creep.memory.home];
        if(home) {
            var exits = Game.map.describeExits(home.name);
            var rooms = Object.keys(exits).map(key => exits[key]).filter(name => !Game.rooms[name]);
            creep.memory.goal = rooms[0];
        }
    } else {
        if(creep.room.name !== creep.memory.goal) {
            var exits = Game.map.findRoute(creep.room, creep.memory.goal);
            var path = creep.pos.findClosestByRange(exits[0].exit);
            creep.moveTo(path);   
        } else {
            creep.moveTo(25, 25);
            creep.say("mine");
        }
    }
}
    