Simulation = require('../../dist/cacatoo') // Loads the Simulation class from installation, or from local package like below
let yargs = require('yargs')
let cmd_params = yargs.argv

let alpha = cmd_params.alpha * 0.2
let tox = cmd_params.tau * 0.3
let seed = cmd_params.alpha * cmd_params.tau

var startTime = performance.now()

// Parameters for initialization
init_lys = 0.0 // Initial abundance of lysogens in superhosts where the phages emerged
init_vir = 10 // Initial abundance of virions in superhosts where the phages emerged

// Parameters for bacteria
r = 1.5     // intrinsic birth rate
Kmin = 1     // minimum bacterial carrying capacity within superhost
deltaK = 9   // change in carrying capacity during superhost infection
thresh = 1     // threshold in toxin production for infecting superhost (disease causing threshold)

// Parameters for phage
beta = 0.5    // Maximum phage adsorption rate
v50 = 1     // Virion abundance for half-maximal adsorption
//alpha = 0.5   // Rate of prophage induction
//tox = 1.5      // Amount of (Rate of) toxin produced by bacteria during lysis (lysogeny)
lamv = 30    // Burst size
delv = 0.01    // Virion rate of decay
mech = "lys"    // Meachnism of toxin production - enter "lys" for lysogenic and "lyt" for lytic

// Parameters for environmental transmission
eps_in = 0.01   // Rate of flow of microbes from environment to superhost
eps_out = 0.01   // Rate of flow of microbes from superhost tot environment

// Parameters for the external environment
Kext = 1    // Carrying capacity in the external environment
v50ext = 10    // Virion abundance for half-maximal adsorption in the environment

// Parameters for the superhost
b = 0.02   // Probability of birth
d = 0.01    // Probability of death (intrinsic)
gamma = 0.4    // Additional probability of death due to disease
vert = 0    // vertical transmission parameter

// ODE parameters
tt = 100   // Number of ODE steps between simulation steps
dt = 0.01  // time elapsed between ode steps

size = 120 // grid length
round = -6  // exponent upto which you want to threshold microbial and viral abundance values

// custom function to round variable values to avoid high precision in measuring abundances
function floor10(value, exp) {
    value = value * 10**(-exp)
    value = Math.floor(value)
    value = value * 10**(exp)
    return value
  }

let config = {
    maxtime: 200000,           
    ncol: size,
    nrow: size,		            // dimensions of the grid to build
    wrap: [true, true],       // Wrap boundary [COLS, ROWS]   
    graph_interval: 10,
    seed: seed
}

let sim = new Simulation(config)

// Creating gridmodel for the superhosts
sim.makeGridmodel("sup");

// Initialization

Kext *= size * size
Ks = size * size

var env_uninf = Kext
var env_lysogen = 0.0
var env_virion = 0.0

var dU_out_cum = 0
var dL_out_cum = 0
var dV_out_cum = 0

var dU_in = 0
var dL_in = 0
var dV_in = 0

sim.sup.initialise = function () {

    // Initially there is a superhost present at every grid point, each with uninfected bacteria at carrying capacity and no phage
    sim.initialGrid(sim.sup, "alive", 1, 1.0)
    sim.initialGrid(sim.sup, "disease", 0, 1.0)
    sim.initialGrid(sim.sup, "uninf", Kmin, 1.0)
    sim.initialGrid(sim.sup, "lysogen", 0.0, 1.0)
    sim.initialGrid(sim.sup, "virion", 10, 1.0)

    sim.max_bac = 10
    sim.max_vir = 1000

    sim.sup.colourViridis("uninf", sim.max_bac)
    sim.sup.colourViridis("lysogen", sim.max_bac)
    sim.sup.colourViridis("virion", sim.max_vir)

    // Below lines lets you specify the superhosts present in a circular region at the centre of the grid of specified radius
    //placeVir = function (gp, init_lys, init_vir) {
        //gp.alive = 1
        //gp.disease = 0
        //gp.uninf = Kmin
        //gp.lysogen = init_lys
        //gp.virion = init_vir
    //}
    //for (let i = 0; i < sim.sup.nc; i++) for (let j = 0; j < sim.sup.nr; j++) {
        //let size = 5
        //if ((Math.pow((i - sim.sup.nc / 2), 2) + Math.pow((j - sim.sup.nr / 2), 2)) < size)
            //placeVir(sim.sup.grid[i][j], init_lys, init_vir)
        //else if ((Math.pow((i - sim.sup.nc / 2), 2) + Math.pow((j - sim.sup.nr / 2), 2)) < size * 50)
            //placeVir(sim.sup.grid[i][j], init_lys, init_vir)

    //}
}

sim.sup.initialise()  // Initialise the superhost population

// Define the next-state function for superhost grid
sim.sup.nextState = function (i, j) {

    this.check_health(i, j)

    if (sim.time % tt == 0 ) {
        // Fill empty site with reproduction, chosen randomly from neighbourhood with birth probability
        if  (this.grid[i][j].alive == 0) {
            let neighbours = this.getMoore8(this, i, j, 'alive',1)

            if (neighbours.length > 0) {
                let winner = this.chooseParent(neighbours, b)
                if (winner != undefined)
                    this.reproduce(i, j, winner)
            }
        }
        else {
            if (this.rng.genrand_real1() < d + gamma * this.grid[i][j].disease){
            this.death(i, j)
            }
        }
    }
    this.Dynamics(i, j)      // Update microbiomes based on ODE
}

// Custom function to choose which superhost in the neighbourhood fills an empty site. Each superhost can reproduce with prob b.
sim.sup.chooseParent = function(gps, b) {
    let sum_prob = 0.0;
    for (let i = 0; i < gps.length; i++) sum_prob += b;       // Now we have the sum of birth probabilities
    let randomnr = this.rng.genrand_real1();                // Sample a randomnr between 0 and sum_prob       
    let cumsum = 0.0;                                                    // This will keep track of the cumulative sum of probabilities
    for (let i = 0; i < gps.length; i++) {
        cumsum += b;
        if (randomnr < cumsum) return gps[i]
    }
    return
}

// Custom function for checking disease state depending on toxin production rate
sim.sup.check_health = function (i, j) {

    if (mech == 'lys') var rate = this.grid[i][j].lysogen * tox
    else if (mech == 'lyt') var rate = this.grid[i][j].lysogen * alpha * tox
    else {
        throw new Error("Enter a valid mechanism of toxin production")
    }

    if (rate < thresh) this.grid[i][j].disease = 0
    else {
        this.grid[i][j].disease = 1
    }
}

// A custom function for copying a cell into a gp at position i,j ("reproduction")
sim.sup.reproduce = function (i, j, winner) {
    this.grid[i][j].alive = winner.alive
    this.grid[i][j].uninf = vert * winner.uninf
    this.grid[i][j].lysogen = vert * winner.lysogen
    this.grid[i][j].virion= vert * winner.virion     
    this.check_health(i, j)            
}

// A custom function for superhost death at position i,j and consequent release of microbiome into the environment
sim.sup.death = function (i, j) {

    env_uninf += this.grid[i][j].uninf
    env_lysogen += this.grid[i][j].lysogen
    env_virion += this.grid[i][j].virion

    this.grid[i][j].alive = 0
    this.grid[i][j].disease = undefined
    this.grid[i][j].uninf = undefined
    this.grid[i][j].lysogen = undefined
    this.grid[i][j].virion = undefined
}

// Custom function for microbiome dynamics in the superhost
sim.sup.Dynamics = function (i, j) {

    if (this.grid[i][j].alive == 0) return

    else {
        var U = this.grid[i][j].uninf
        var L = this.grid[i][j].lysogen
        var V = this.grid[i][j].virion
        var dis = this.grid[i][j].disease

        var dU = dt * ( r * U * (1-(U+L)/(Kmin + dis*deltaK)) - beta * U * V/(V+v50))
        var dL = dt * ( r * L * (1-(U+L)/(Kmin + dis*deltaK)) + beta * U * V/(V+v50) - alpha * L)
        var dV = dt * ( lamv * alpha * L - delv * V)

        this.grid[i][j].uninf = floor10(this.grid[i][j].uninf + dU, round)
        this.grid[i][j].lysogen = floor10(this.grid[i][j].lysogen + dL, round)
        this.grid[i][j].virion = floor10(this.grid[i][j].virion + dV, round)

        var dU_out = dt * eps_out * this.grid[i][j].uninf
        var dL_out = dt * eps_out * this.grid[i][j].lysogen
        var dV_out = dt * eps_out * this.grid[i][j].virion

        dU_out_cum += dU_out
        dL_out_cum += dL_out
        dV_out_cum += dV_out

        this.grid[i][j].uninf = floor10(this.grid[i][j].uninf + dU_in - dU_out, round)
        this.grid[i][j].lysogen = floor10(this.grid[i][j].lysogen + dL_in - dL_out, round)
        this.grid[i][j].virion = floor10(this.grid[i][j].virion + dV_in - dV_out, round)
    }
}

sim.sup.update = function () {

    var U = env_uninf
    var L = env_lysogen
    var V = env_virion

    var dU = dt * ( r * U * (1-(U+L)/Kext) - beta * U * V/(V+v50ext))
    var dL = dt * ( r * L * (1-(U+L)/Kext) + beta * U * V/(V+v50ext))
    var dV = dt * (- delv * V)

    env_uninf = floor10(env_uninf + dU, round)
    env_lysogen = floor10(env_lysogen + dL, round)
    env_virion = floor10(env_virion + dV, round)

    dU_in = dt * eps_in * env_uninf/ Ks
    dL_in = dt * eps_in * env_lysogen/ Ks
    dV_in = dt * eps_in * env_virion/ Ks
            
    this.synchronous()   
    this.perfectMix()

    let num_alive = 0, num_healthy=0, num_disease=0
    for (let i = 0; i < sim.sup.nc; i++) for (let j = 0; j < sim.sup.nr; j++) {
        if (this.grid[i][j].alive == 1) {
            num_alive++
            if (this.grid[i][j].disease == 1)
                num_disease++
            else {
                num_healthy++
            }
        }
    }

    env_uninf = floor10(env_uninf - dU_in * num_alive + dU_out_cum, round)
    env_lysogen = floor10(env_lysogen - dL_in * num_alive + dL_out_cum, round)
    env_virion = floor10(env_virion - dV_in * num_alive + dV_out_cum, round)

    dU_out_cum = 0
    dL_out_cum = 0
    dV_out_cum = 0

    // Write to file / the terminal after some time or when all superhosts go extinct
    if(sim.time==50000 || num_alive==0){
        sim.log(`Superhost population size for tau ${tox} and alpha ${alpha} is ${num_alive}, and ${num_healthy} are healthy`)        
        if(sim.time==0) sim.write("tau\talpha\tnum_alive\tnum_healthy\tenv_uninf\tenv_lysogen\tenv_virion\n", "ULV_output_directory/wellmixed_ecology.dat") // use sim.write to make a header for the output file
        sim.write_append(tox+'\t'+alpha+'\t'+num_alive+'\t'+num_healthy+'\t'+env_uninf+'\t'+env_lysogen+'\t'+env_virion+'\n', "ULV_output_directory/wellmixed_ecology.dat")  
        
        var endTime = performance.now()
        sim.log(endTime - startTime + " milliseconds execution time")
        process.exit()
    }
}

sim.start()