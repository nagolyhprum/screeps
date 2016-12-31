


var recommendations = [{
    count : groups => Math.min(hasSize(groups.harvester) + 1, getWorkerCount(groups)),
    type : miner,
    body : groups => makeBody(groups, [MOVE, WORK], [WORK], hasHalf(groups))
}, {
    count : groups => Math.min(hasSize(groups.miner) * 2, getWorkerCount(groups) * 2), 
    type : harvester,
    body : groups => makeBody(groups, [CARRY, MOVE], [CARRY, MOVE], hasHalf(groups))
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
        if(Object.keys(Game.spawns) * 5 <= Object.keys(Game.rooms)) {
            var exits = Game.map.describeExits(groups.room.name);
            return Object.keys(exits).map(key => exits[key]).filter(room => !Game.rooms[room]).length;
        }
        return 0;
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
        var creep = Game.creeps[key];
        creeps.push(creep);
        if(!Game.rooms[creep.memory.home]) {
            creep.memory.home = Game.spawns[Object.keys(Game.spawns)[0]].room.name;
        }
        return creeps;
    }, []);
    var now = new Date().getTime();
    var toSpawn = [];
    for(var i in Game.rooms) {
        var r = Game.rooms[i];
        room(r, creeps, now, toSpawn);
        addSites(r);
        var hostiles = getHostiles(r);
        r.find(FIND_STRUCTURES, {
            filter : structure => structure.structureType === STRUCTURE_TOWER
        }).forEach(tower => {
            hostiles.forEach(hostile => tower.attack(hostile));
        });
    }
    toSpawn.sort((a, b) => b.level - a.level);
    for(var i in Game.spawns) {
        var spawn = Game.spawns[i];
        var data = toSpawn[toSpawn.length - 1];
        if(data && spawn.createCreep(data.body, undefined, data.memory) === OK) {
            toSpawn.pop();
        }
    }
    if(redAlertRoom) {
        console.log("RED ALERT IN ", redAlertRoom);
    }
    console.log("--------");
};

//HELPERS

function hasHalf(groups) {
    var workers = Math.floor(getWorkerCount(groups) / 2);
    return hasSize(groups.miner) >= workers && hasSize(groups.harvester) >= workers;
}

function makeBody(groups, front, sequence, doit) {
    var max = sequence.reduce((cost, part) => cost + BODYPART_COST[part], 0) * Object.keys(Game.spawns).length;
    var cost = front.reduce((cost, part) => cost + BODYPART_COST[part], 0);
    var i = 0;
    while(doit && (cost += BODYPART_COST[sequence[i % sequence.length]]) <= groups.spawn.room.energyCapacityAvailable && cost <= max) {
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
        var area = getMiningSpots(groups, source);
        return area.length + spaces;
    }, 0) / 2;
}

function getMiningSpots(groups, source) {
    var x = source.pos.x, y = source.pos.y;
    return groups.room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true).filter(terrain => terrain.terrain !== "wall")
}

function getMiningCreeps(groups, source) {
    var x = source.pos.x, y = source.pos.y;
    return groups.room.lookForAtArea(LOOK_CREEPS, y - 1, x - 1, y + 1, x + 1, true);
}

function fighterBody(groups) {
    return makeBody(groups, [MOVE, ATTACK, TOUGH, TOUGH], [MOVE, ATTACK, TOUGH, TOUGH], true);
}

function workerBody(groups) {
    return makeBody(groups, [MOVE, CARRY, WORK], [MOVE, CARRY], true);
}

function hasSize(r) {
    return r ? r.length : 0;
}

function createPath(creep) {
    var x = creep.pos.x, y = creep.pos.y;
    var terrain = creep.room.lookForAt(LOOK_TERRAIN, x, y)[0];
    if(terrain === "swamp") {
        creep.room.createConstructionSite(x, y, STRUCTURE_ROAD);
    }
}

var mycs = {};

function moveTo(creep) {
    var args = Array.prototype.slice.call(arguments, 1);
    var path = creep.pos.findPathTo.apply(creep.pos, args);
    creep.moveByPath(path);
}

function getDropped(creep) {
    if(creep.carry.energy < creep.carryCapacity) {
        if(!goHome(creep)) {
            var droppedEnergy = getDroppedList(creep.room);
            var t = target(creep, droppedEnergy);
            if(creep.pickup(t) == ERR_NOT_IN_RANGE) {
                moveTo(creep, t, {
                    maxRooms : 1
                });  
            }
        }
        return true;
    }
    return false;
}

function fight(creep) {
    var hostiles = getHostiles(creep.room);
    var hostile = target(creep, hostiles)
    if(hostile) {
        if(creep.attack(hostile) === ERR_NOT_IN_RANGE) {
           moveTo(creep, hostile, {
               maxRooms : 1
           }); 
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
            if(callback(x - range + i, y - range) || callback(x - range, y - range + i) || callback(x + range, y - range + i) || callback(x - range + i, y + range)) {
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
    addSite(room, STRUCTURE_SPAWN);
    addSite(room, STRUCTURE_TOWER);
    addSite(room, STRUCTURE_EXTENSION);
}

function goToRoom(creep, room) {
    var exits = Game.map.findRoute(creep.room.name, room);
    var exit = creep.pos.findClosestByPath(exits[0].exit);
    if(exit) {
        moveTo(creep, exit, {
            maxRooms : 1
        }); 
    }  
}

function goHome(creep) {
    createPath(creep);
    if(creep.room.name !== creep.memory.home) {
        goToRoom(creep, creep.memory.home);
        return true;
        
    }
    return false;
}

function target(creep, targets) {
    var target = targets.find(target => target.id === creep.memory.target) || targets[0];
    target && (creep.memory.target = target.id);
    return target;
}

function getDroppedList(room) {
    return room.find(FIND_DROPPED_ENERGY).sort((a, b) => b.amount - a.amount);;
}

function getStorage(room) {
    return room.find(FIND_STRUCTURES, {
            filter: (structure) => {
            return (structure.structureType == STRUCTURE_EXTENSION || structure.structureType == STRUCTURE_SPAWN || structure.structureType == STRUCTURE_TOWER) && structure.energy < structure.energyCapacity;
        }
    }).sort((a, b) => a.energyCapacity - b.energyCapacity).reduce((sources, source) => {
        if(source.structureType === STRUCTURE_SPAWN) {
            sources.push(source);
        } else {
            sources.unshift(source);
        }
        return sources;
    }, []);
}

function getHostiles(room) {
    return [...room.find(FIND_HOSTILE_STRUCTURES), ...room.find(FIND_HOSTILE_CREEPS)];
}

function getDamaged(room) {
    return room.find(FIND_STRUCTURES, {
        filter : structure => structure.hits < structure.hitsMax
    }).sort((a, b) => (b.hitsMax - b.hits) - (a.hitsMax - a.hits));
}

function getSites(room) {
    return room.find(FIND_CONSTRUCTION_SITES).sort((a, b) => (b.progressTotal + b.progress) - (a.progressTotal + a.progress));
}

//ROLES

function room(room, creeps, now, toSpawn) {
    var spawn = Game.spawns[Object.keys(Game.spawns).find(key => Game.spawns[key].room === room)] || Game.spawns[Object.keys(Game.spawns)[0]];
    var groups = creeps.filter(creep => creep.memory.home === room.name).reduce((groups, creep) => {
        var r = groups[creep.memory.type] = groups[creep.memory.type] || [];
        r.push(creep);
        return groups;
    }, {});
    console.log(Object.keys(groups).sort().map(key => [key, groups[key].length]));
    groups.now = now;
    groups.spawn = spawn;
    groups.room = room;
    recommendations.forEach((recommendation, level) => {
        var type = recommendation.type.name, count = groups[type] ? groups[type].length : 0;
        if(count < recommendation.count(groups)) {
            toSpawn.push({
                body : recommendation.body(groups),
                level,
                memory : {
                    type : type,
                    home : room.name
                }
            });
        }
        if(groups[type]) {
            groups[type].forEach(creep => {
                recommendation.type(creep, groups)
                redAlert(creep);
            });
        }
    });
}

function harvester(creep, groups) {
    if(switchStates(creep)) {
        var targets = getStorage(groups.spawn.room);
        var t = target(creep, targets);
        if(t) {
            if(creep.transfer(t, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                moveTo(creep, t, {});
            }
        }
    } else {
        getDropped(creep);
    }
}
        
function builder(creep, groups) {
    if(switchStates(creep)) {
        var targets = getDamaged(creep.room);
        var t = target(creep, targets)
        if(t) {
            if(creep.repair(t) == ERR_NOT_IN_RANGE) {
                moveTo(creep, t, {
                    maxRooms : 1
                });
            }
        } else {
            var targets = getSites(creep.room);
            var t = target(creep, targets);
            if(t) { 
                var cs = Game.constructionSites[t.id];
                if(creep.build(cs) == ERR_NOT_IN_RANGE) {
                    moveTo(creep, cs, {
                        maxRooms : 1
                    });
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
    if(switchStates(creep)) {
        var controller = groups.spawn.room.controller;
        if(creep.upgradeController(controller) == ERR_NOT_IN_RANGE) {
            moveTo(creep, controller, {});
        }
    } else {
        getDropped(creep);
    }
}

var five_minutes = 1000 * 60 * 5;

function fighter(creep, groups) {
    if(redAlertRoom) {
        if(!fight(creep)) {
            goToRoom(creep, redAlertRoom);
        }
    } else if(!fight(creep) && !goHome(creep)) {
        switch(Math.floor(groups.now / five_minutes) % 4) {
            case 0 :
                moveTo(creep, 10, 10, {
                    maxRooms : 1
                });
                break;
            case 1 :
                moveTo(creep, 40, 10, {
                    maxRooms : 1
                });
                break;
            case 2 :
                moveTo(creep, 40, 40, {
                    maxRooms : 1
                });
                break;
            case 3 :
                moveTo(creep, 10, 40, {
                    maxRooms : 1
                });
                break;
        }
    }
}

var redAlertRoom;

function redAlert(creep) {
    var hostiles = getHostiles(creep.room);
    if(hostiles.length) {
        redAlertRoom = creep.room.name;
    } else if(creep.room.name === redAlertRoom) {
        redAlertRoom = false;
    }
}

function miner(creep, groups) {
    if(!goHome(creep)) {
        var move = creep.pos.findClosestByPath(FIND_SOURCES, {
            filter : source => {
                var spots = Math.ceil(getMiningSpots(groups, source).length / 2);
                var creeps = getMiningCreeps(groups, source).length;
                return spots >= creeps;
            }
        });
        var mine = creep.pos.findClosestByPath(FIND_SOURCES);
        if(creep.harvest(mine) === ERR_NOT_IN_RANGE) {
            moveTo(creep, move || mine, {
                maxRooms : 1
            });
        }
    }
}

function expander(creep, groups) {
    groups.expander.forEach((expander, i) => i > 0 && expander.suicide());
    if(!creep.memory.goal) {
        var home = Game.rooms[creep.memory.home];
        if(home) {
            var exits = Game.map.describeExits(home.name);
            var rooms = Object.keys(exits).map(key => exits[key]).filter(name => !Game.rooms[name]);
            creep.memory.goal = rooms[0];
        }
    } else {
        if(creep.room.name !== creep.memory.goal) {
            goToRoom(creep, creep.memory.goal);
        } else {
            moveTo(creep, 25, 25, {
                maxRooms : 1
            });
            creep.say("mine");
        }
    }
}
    