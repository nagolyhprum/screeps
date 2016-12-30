
var recommendations = [{
    count : groups => Math.min(hasSize(groups.harvester) + 1, getWorkerCount(groups)),
    type : miner,
    body : groups => makeBody(groups, [MOVE, WORK], [WORK], hasHalf(groups))
}, {
    count : groups => Math.min(hasSize(groups.miner) + 1, getWorkerCount(groups)), 
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
    count : fightersCount,
    type : fighter,
    body : fighterBody
}/*, {
    count : groups => 0, 
    type : explorer,
    body : groups => makeBody(groups, [], [MOVE], true)
}, {
    count : groups => 0,
    type : away,
    body : fighterBody
}*/];

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
    for(var i in Game.rooms) {
        var r = Game.rooms[i];
        room(r, creeps);
        addExtension(r);
        var now = new Date().getTime();
        r.find(FIND_CONSTRUCTION_SITES).forEach(cs => {
            if(cs.structureType === STRUCTURE_ROAD) {
                var date = Memory.roads[cs.pos.x + cs.pos.y * 50] || 0;
                if(now - date >= 1000  * 60) {
                    cs.remove();
                }
            }
        });
    }
};

//HELPERS

function hasHalf(groups) {
    var workers = getWorkerCount(groups) / 2;
    return hasSize(groups.miner) >= workers && hasSize(groups.harvester) >= workers;
}

function makeBody(groups, front, sequence, doit) {
    var cost = front.reduce((cost, part) => cost + BODYPART_COST[part], 0);
    var i = 0;
    while(doit && (cost += BODYPART_COST[sequence[i % sequence.length]]) <= groups.room.energyCapacityAvailable) {
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
    return makeBody(groups, [MOVE, ATTACK], [TOUGH, TOUGH, ATTACK], true);
}

function workerBody(groups) {
    return makeBody(groups, [MOVE, CARRY, WORK], [MOVE, CARRY, WORK], true);
}

function hasSize(r) {
    return r ? r.length : 0;
}

function fightersCount() {
    var count = getThreats().length + 1;
    return count * count;
}

function getThreats() {
    return 0;
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
        var droppedEnergy = creep.room.find(FIND_DROPPED_ENERGY).sort((a, b) => b.amount - a.amount);
        var goal = droppedEnergy.find(energy => energy.id === creep.memory.goal) || droppedEnergy[0];
        if(creep.pickup(goal) == ERR_NOT_IN_RANGE) {
            creep.moveTo(goal); 
            creep.memory.goal = goal.id; 
        } else {
            creep.memory.goal = false;
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

function addExtension(room) {
    var cs = room.find(FIND_CONSTRUCTION_SITES);
    if(cs.length < MAX_CONSTRUCTION_SITES) {
        var max = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller ? room.controller.level : 0];
        var built = room.find(FIND_STRUCTURES, {
            filter : structure => structure.structureType === STRUCTURE_EXTENSION 
        }).length;
        var toBuild = room.find(FIND_CONSTRUCTION_SITES, {
            filter : cs => cs.structureType === STRUCTURE_EXTENSION
        }).length;
        if(built + toBuild < max) {
            squareFrom(25, 25, (x, y) => {
                var terrain = room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true);
                var hasWall = terrain.reduce((hasWall, terrain) => hasWall || terrain.terrain === "wall", false);
                var goodSpot = (x + y) % 2 === 1 && !hasWall;
                var result = goodSpot ? room.createConstructionSite(x, y, STRUCTURE_EXTENSION) : false;
                return x === -1 && y === -1 || result === OK;
            });   
        }
    }
}

function requires(creep, r) {
    var missing = r.reduce((all, part) => all || (!creep.body.find(p => p.type === part) ? part : false), false);
    if(missing) {
        creep.suicide();
        //creep.say(missing);
    }
}

//ROLES

function room(room, creeps) {
    var spawn = Game.spawns[Object.keys(Game.spawns).find(key => Game.spawns[key].room === room)] || Game.spawns[Object.keys(Game.spawns)[0]];
    var groups = creeps.filter(creep => creep.room === room).reduce((groups, creep) => {
        var r = groups[creep.memory.type] = groups[creep.memory.type] || [];
        r.push(creep);
        return groups;
    }, {});
    groups.spawn = spawn;
    groups.room = room;
    console.log(Object.keys(groups).map(key => [key, groups[key].length]))
    var free = creeps.filter(creep => !creep.memory.type);
    var canSpawn = OK;
    recommendations.forEach(recommendation => {
        var type = recommendation.type.name, count = groups[type] ? groups[type].length : 0;
        if(count < recommendation.count(groups) && canSpawn === OK) {
            if(free.length) {
                var creep = free.shift();
                creep.memory.type = type;
                creep.memory.home = room.name;
            } else {
                canSpawn = spawn.createCreep(recommendation.body(groups), "Logan Spawn " + new Date().getTime(), {
                    type : type,
                    home : room.name
                });
            }
        }
        if(groups[type]) {
            groups[type].forEach(creep => recommendation.type(creep, groups));
        }
    });
}

function harvester(creep) {
    requires(creep, [CARRY, MOVE]);
    if(!getDropped(creep)) {
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_EXTENSION || structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity;
            }
        }).sort((a, b) => a.energyCapacity - b.energyCapacity);
        if(targets.length > 0) {
            if(creep.transfer(targets[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                creep.moveTo(targets[0]);
            }
        }
    }
}

function goHome(creep) {
    return false;
}

function builder(creep) {
    if(goHome(creep)) return;
    requires(creep, [WORK, CARRY, MOVE]);
    if(creep.memory.building && creep.carry.energy == 0) {
        creep.memory.building = false;
        creep.say('harvesting');
    } else if(!creep.memory.building && creep.carry.energy == creep.carryCapacity) {
        creep.memory.building = true;
        creep.say('building');
    }
    if(creep.memory.building) {
        var targets = creep.room.find(FIND_CONSTRUCTION_SITES).sort((a, b) => (b.progressTotal + b.progress) - (a.progressTotal + a.progress));
        if(targets.length) {
            if(creep.build(targets[0]) == ERR_NOT_IN_RANGE) {
                creep.moveTo(targets[0]);
            }
        } else {
            var targets = creep.room.find(FIND_STRUCTURES).sort((a, b) => (b.hitsMax - b.hits) - (a.hitsMax - a.hits));
            if(targets.length && targets[0].hits < targets[0].hitsMax) {
                if(creep.repair(targets[0]) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(targets[0]);
                }
            } else {
                upgrader(creep);
            }
        }
        
    } else {
        getDropped(creep);
    }
}

function upgrader(creep) {
    requires(creep, [WORK, MOVE, CARRY]);
    if(!creep.memory.harvesting && creep.carry.energy == 0) {
        creep.memory.harvesting = true;
        creep.say("HARVESTING");
    } else if(creep.memory.harvesting && creep.carry.energy == creep.carryCapacity) {
        creep.memory.harvesting = false;
        creep.say("UPGRADING");
    }
    if(creep.memory.harvesting) {
        getDropped(creep);
    } else if(creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller);
    }
}

function fighter(creep) {
    if(!fight(creep)) {
        creep.moveTo(creep.room.controller);
    }
}

Memory.rooms = Memory.rooms || {};
Memory.hostileRooms = Memory.hostileRooms || {};
function explorer(creep) {
    if(creep.room.controller && !creep.room.controller.my && creep.room.controller.owner) {
        Memory.hostileRooms[creep.room.name] = true;
        creep.moveTo(creep.room.controller);
        creep.say("sup bitch");
        return;
    }
    Memory.hostileRooms[creep.room.name] = false;
    var exits = Game.map.describeExits(creep.room.name); //get the exits "dir" : "name"
    var key = Object.keys(exits).sort((a, b) => (Memory.rooms[exits[a]] || 0) - (Memory.rooms[exits[b]] || 0))[0]; //sort by visit count
    if(creep.memory.currentRoom !== creep.room.name) {
        var value = Memory.rooms[creep.room.name] || 0; //get visit count
        Memory.rooms[creep.room.name] = value + 1; //set the visit count   
    }
    creep.memory.currentRoom = creep.room.name;
    var dir = Game.map.findRoute(creep.room.name, exits[key]); //find direction
    var closest = creep.pos.findClosestByRange(dir[0].exit); //find the path
    creep.moveTo(closest); //go there
}
 
var awayIndex = 0;

function away(creep, groups) {
    var count = groups.away.reduce((count, creep) => count + (!creep.memory.party ? 1 : 0), 0);
    if(count === fightersCount()) {
        var found = 0, index = 0;
        awayIndex++;
        while(found < fightersCount()) {
            if(!groups.away[index].memory.party) {
                groups.away[index].memory.party = awayIndex;
                found++;
            }
            index++;
        }
    }
    if(creep.memory.party) {
        if(!fight(creep)) {
            var goals = getThreats();
            var goal = goals[creep.memory.party % goals.length];
            if(goal) {
                if(creep.room.name === goal) {
                    fighter(creep);
                    return;
                }
                var route = Game.map.findRoute(creep.room.name, goal);
                var closest = creep.pos.findClosestByRange(route[0].exit); //find the path
                creep.moveTo(closest);
            } else {
                fighter(creep);
            }
        }
    } else {
        fighter(creep);
    }
}

function miner(creep) {
    requires(creep, [WORK, MOVE]);
    var target = creep.pos.findClosestByPath(FIND_SOURCES);
    if(creep.harvest(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
    }
}
    