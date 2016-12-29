function makeBody(groups, front, sequence, doit) {
    var cost = front.reduce((cost, part) => cost + BODYPART_COST[part], 0);
    var i = 0;
    while(doit && (cost += BODYPART_COST[sequence[i % sequence.length]]) <= groups.room.energyCapacityAvailable) {
        front.push(sequence[i % sequence.length]);
        i++;
    }
    return front;
}

function fighterBody(groups) {
    return makeBody(groups, [MOVE], [ATTACK, TOUGH, TOUGH], true);
}

function workerBody(groups) {
    return makeBody(groups, [MOVE, CARRY, WORK], [MOVE, CARRY, WORK], true);
}

var PARTY_SIZE = 0, recommendations = [{
    count : 2, 
    type : harvester,
    body : groups => makeBody(groups, [CARRY, MOVE], [CARRY, MOVE], groups.miner.length)
}, {
    count : 6,
    type : miner,
    body : groups => makeBody(groups, [MOVE, WORK], [WORK], groups.harvester.length)
}, {
    count : 6,
    type : upgrader,
    body : workerBody
}, {
    count : 6,
    type : builder,
    body : workerBody
}, {
    count : 6,
    type : fighter,
    body : fighterBody
}, {
    count : 1, 
    type : explorer,
    body : groups => makeBody(groups, [], [MOVE], true)
}, {
    count : PARTY_SIZE,
    type : away,
    body : () => fighterBody
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
    for(var i in Game.rooms) {
        var r = Game.rooms[i];
        room(r, creeps);
        addExtension(r)
    }
};

//HELPERS

function createPath(creep) {
    var x = creep.pos.x, y = creep.pos.y;
    var structures = creep.room.lookForAt(LOOK_STRUCTURES, x, y);
    var hasRoad = structures.reduce((hasRoad, structure) => hasRoad || structure.structureType === STRUCTURE_ROAD, false);
    if(!hasRoad) {
        creep.room.createConstructionSite(x, y, STRUCTURE_ROAD);
    }
}

function getDropped(creep) {
    createPath(creep);
    if(creep.carry.energy < creep.carryCapacity) {
        var droppedEnergy = creep.room.find(FIND_DROPPED_ENERGY).sort((a, b) => b.amount - a.amount);
        if(creep.pickup(droppedEnergy[0]) == ERR_NOT_IN_RANGE) {
           creep.moveTo(droppedEnergy[0]); 
        }
        return true;
    }
    return false;
}

//ROLES

function room(room, creeps) {
    var spawn = Game.spawns[Object.keys(Game.spawns).find(key => Game.spawns[key].room === room)];
    var groups = creeps.filter(creep => creep.room === room).reduce((groups, creep) => {
        var r = groups[creep.memory.type] = groups[creep.memory.type] || [];
        r.push(creep);
        return groups;
    }, {});
    groups.spawn = spawn;
    groups.room = room;
    if(spawn) {
        console.log(Object.keys(groups).map(key => [key, groups[key].length]))
    }
    var canSpawn = OK;
    recommendations.forEach(recommendation => {
        var type = recommendation.type.name, count = groups[type] ? groups[type].length : 0;
        if(count < recommendation.count && spawn && canSpawn === OK) {
            canSpawn = spawn.createCreep(recommendation.body(groups), "Logan Spawn " + new Date().getTime(), {
                type : type
            });
        } else if(count > recommendation.count) {
            //creeps[type][0].suicide();
        }
        if(groups[type]) {
            groups[type].forEach(creep => recommendation.type(creep, groups));
        }
    });
}

function harvester(creep) {
    if(!getDropped(creep)) {
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_EXTENSION || structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity;
            }
        });
        if(targets.length > 0) {
            if(creep.transfer(targets[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                creep.moveTo(targets[0]);
            }
        }
    }
}

function squareFrom(x, y, callback) {
    var range = 0;
    while(true) {
        for(var i = x - range; i <= x + range; i++) {
            for(var j = y - range; j <= y + range; j++) {
                if(callback(i, j)) {
                    return;
                }
            }
        }      
        range++;
    }
}

function addExtension(room) {
    squareFrom(25, 25, (x, y) => {
        var terrain = room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true);
        var hasWall = terrain.reduce((hasWall, terrain) => hasWall || terrain.terrain === "wall", false);
        var result = (x + y) % 2 === 1 && !hasWall ? room.createConstructionSite(x, y, STRUCTURE_EXTENSION) : false;
        return x === -1 && y === -1 || result === ERR_RCL_NOT_ENOUGH || result === OK;
    });
}

function builder(creep) {
    if(creep.memory.building && creep.carry.energy == 0) {
        creep.memory.building = false;
        creep.say('harvesting');
    } else if(!creep.memory.building && creep.carry.energy == creep.carryCapacity) {
        creep.memory.building = true;
        creep.say('building');
    }
    if(creep.memory.building) {
        var targets = creep.room.find(FIND_CONSTRUCTION_SITES).sort((a, b) => (a.progressTotal - a.progress) - (b.progressTotal - b.progress));
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

function fight(creep) {
    var hostiles = [...creep.room.find(FIND_HOSTILE_STRUCTURES), ...creep.room.find(FIND_HOSTILE_CREEPS)];
    if(hostiles.length) {
        if(creep.attack(hostiles[0]) === ERR_NOT_IN_RANGE) {
           creep.moveTo(hostiles[0]); 
        }
        return true;
    }
    return false;
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
    if(count === PARTY_SIZE) {
        var found = 0, index = 0;
        awayIndex++;
        while(found < PARTY_SIZE) {
            if(!groups.away[index].memory.party) {
                groups.away[index].memory.party = awayIndex;
                found++;
            }
            index++;
        }
    }
    if(creep.memory.party) {
        if(!fight(creep)) {
            var goals = Object.keys(Memory.hostileRooms).filter(key => Memory.hostileRooms[key]);
            var goal = goals[creep.memory.party % goals.length];
            if(goal) {
                if(creep.room.name === goal) {
                    fighter(creep);
                    return;
                }
                var route = Game.map.findRoute(creep.room.name, goal);
                var closest = creep.pos.findClosestByRange(route[0].exit); //find the path
                creep.moveTo(closest);
            }
        }
    } else {
        fighter(creep);
    }
    
}

function miner(creep) {
    var target = creep.pos.findClosestByPath(FIND_SOURCES);
    if(creep.harvest(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
    }
}
    