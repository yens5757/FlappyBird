/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 */

import "./style.css";

import {
    Observable,
    catchError,
    filter,
    fromEvent,
    interval,
    map,
    merge,
    scan,
    switchMap,
    take,
    timer,
} from "rxjs";
import { fromFetch } from "rxjs/fetch";

/** Constants */

const Viewport = {
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 400,
} as const;

const Birb = {
    WIDTH: 42,
    HEIGHT: 30,
} as const;

const Constants = {
    PIPE_WIDTH: 50,
    TICK_RATE_MS: 20, // changed from 500 to 20
    GRAVITY: 0.5,
    FLAP_STRENGTH: -8,
    BIRD_X: 100, // this won't be changed throughout the game
    PIPE_SPEED: 2,
} as const;

// State processing

type State = Readonly<{
    birdY: number;
    birdVelocity: number;
    gameTime: number;
    pipes: ReadonlyArray<Pipe>; // array to store the pipes
    score: number;
    gameEnd: boolean;
    lives: number;
    rngSeed: number; // applied class rng
    invulnerableUntil: number;
    currentPath: ReadonlyArray<number>; // Recording current run
    ghostPath: ReadonlyArray<number>; // Previous run to replay
    paused: boolean;
}>;

// pipe class, we store these at the state

type Pipe = Readonly<{
    id: number;
    x: number;
    gapY: number;
    gapHeight: number;
    passed: boolean; // if we passed it already we set it to True
    time: number;
}>;

const initialState: State = {
    birdY: Viewport.CANVAS_HEIGHT / 2 - Birb.HEIGHT / 2, // bird will be center of the canvas
    birdVelocity: 0,
    pipes: [],
    gameTime: 0,
    score: 0,
    gameEnd: false,
    lives: 3,
    rngSeed: 12345,
    invulnerableUntil: 0,
    currentPath: [],
    ghostPath: [],
    paused: false,
};

// imported directly from weekly submission

abstract class RNG {
    private static m = 0x80000000; // 2^31
    private static a = 1103515245;
    private static c = 12345;

    public static hash = (seed: number): number =>
        (RNG.a * seed + RNG.c) % RNG.m;

    public static scale = (hash: number): number =>
        (2 * hash) / (RNG.m - 1) - 1; // in [-1, 1]
}

/**
 * Updates the state by proceeding with one time step.
 *
 * @param allPipes pipes array that contains ALL PIPES(Not just existing pipes)
 * @returns A function that takes the current state and returns the updated state
 */
const tick =
    (allPipesLength: number) =>
    (s: State): State => {
        // if game ended is flag as True or it's paused, we do not update the state
        if (s.gameEnd || s.paused) return s;

        // the velocity will keep getting higher and higher as time goes
        const velocity = s.birdVelocity + Constants.GRAVITY;
        const y = s.birdY + velocity;

        // calculate game time by calculating our tick
        const newTime = s.gameTime + Constants.TICK_RATE_MS / 1000;

        const movedPipes = s.pipes
            .map(pipe => ({ ...pipe, x: pipe.x - Constants.PIPE_SPEED }))
            // if pipe is not passed AND the pipe is on the left, that means we passed the pipe already
            .filter(pipe => pipe.x > -Constants.PIPE_WIDTH);

        const pipesWithScore = movedPipes.map(pipe =>
            !pipe.passed && pipe.x + Constants.PIPE_WIDTH < Constants.BIRD_X
                ? { ...pipe, passed: true }
                : pipe,
        );

        // After we check the passed Pipes, we calculate the amount of pipes we passed in this 1 tick and use it as score
        const newlyPassed = movedPipes.filter(
            pipe =>
                !pipe.passed &&
                pipe.x + Constants.PIPE_WIDTH < Constants.BIRD_X,
        ).length;

        // adding the score
        const newScore = s.score + newlyPassed;

        // checking if we've passed all the pipes
        const allPipesPassed = allPipesLength > 0 && newScore >= allPipesLength;

        // Check if we are vulnerable to collision
        const isVulnerable = newTime >= s.invulnerableUntil;
        if (isVulnerable) {
            // we need to have 3 function for hitting the top/bottom of the screen and the pipes
            // so we can decide on the bounce
            const hitTop = checkBirdHitsTop(y);
            const hitBottom = checkBirdHitsBottom(y);
            const hitPipe = s.pipes.find(pipe => checkBirdHitsPipe(y, pipe));

            if (hitTop || hitBottom || hitPipe) {
                // Determine bounce direction
                let shouldBounceUp = false;
                if (hitBottom) {
                    shouldBounceUp = true;
                } else if (hitTop) {
                    shouldBounceUp = false;
                } else if (hitPipe) {
                    const collisionType = getPipeCollisionType(y, hitPipe);
                    shouldBounceUp = collisionType === "bottom";
                }

                // Generate random bounce velocity
                const [bounceVelocity, newSeed] = generateBounceVelocity(
                    s.rngSeed,
                    shouldBounceUp,
                );

                // Apply collision effects
                return {
                    ...s,
                    birdY: y,
                    birdVelocity: bounceVelocity,
                    pipes: pipesWithScore,
                    gameTime: newTime,
                    lives: s.lives - 1,
                    rngSeed: newSeed,
                    invulnerableUntil: newTime + 2, // this is set to 2 second
                    score: newScore,
                    gameEnd: s.lives - 1 <= 0 || allPipesPassed,
                    currentPath: [...s.currentPath, y],
                };
            }
        }

        // normal update if no collision
        const clampedY = Math.max(
            0,
            Math.min(Viewport.CANVAS_HEIGHT - Birb.HEIGHT, y),
        );

        return {
            ...s,
            birdY: clampedY,
            birdVelocity: velocity,
            pipes: pipesWithScore,
            score: newScore,
            gameTime: newTime,
            invulnerableUntil: s.invulnerableUntil,
            gameEnd: allPipesPassed,
            currentPath: [...s.currentPath, clampedY],
        };
    };

/**
 * Process the csv string into the pipes array
 * @param csvContent the entire csv string
 */
const parseCSV = (csvContent: string): ReadonlyArray<Pipe> => {
    const lines = csvContent.trim().split("\n");

    // ignores first line and output a array of objects
    return lines.slice(1).map((line, index) => {
        const [gapY, gapHeight, time] = line
            .split(",")
            .map(v => parseFloat(v.trim()));
        return {
            id: index,
            x: Viewport.CANVAS_WIDTH,
            gapY,
            gapHeight,
            passed: false,
            time,
        };
    });
};

/**
 * Updates pipe positions and spawns new pipes based on time
 * @param currentPipes Currently visible pipes
 * @param allPipes All pipes from CSV
 * @param gameTime Current game time in seconds
 * @returns Updated array of visible pipes
 */
const updatePipes = (
    currentPipes: ReadonlyArray<Pipe>,
    allPipes: ReadonlyArray<Pipe>,
    gameTime: number,
): ReadonlyArray<Pipe> => {
    // Move existing pipes left
    const movedPipes = currentPipes
        .map(pipe => ({ ...pipe, x: pipe.x - Constants.PIPE_SPEED }))
        // Remove off-screen pipes
        .filter(pipe => pipe.x > -Constants.PIPE_WIDTH);

    // Check for new pipes to spawn at this time
    const newPipes = allPipes.filter(
        pipe =>
            Math.abs(pipe.time - gameTime) < Constants.TICK_RATE_MS / 1000 &&
            // If not already spawned, then spawn
            !currentPipes.some(p => p.id === pipe.id),
    );
    return [...movedPipes, ...newPipes];
};

/**
 * Checks if bird hits the top boundary
 * @param birdY Current Y position of bird
 * @returns true if bird hits top
 */
const checkBirdHitsTop = (birdY: number): boolean => birdY <= 0;

/**
 * Checks if bird hits the bottom boundary
 * @param birdY Current Y position of bird
 * @returns true if bird hits bottom
 */
const checkBirdHitsBottom = (birdY: number): boolean =>
    birdY + Birb.HEIGHT >= Viewport.CANVAS_HEIGHT;

/**
 * Checks if bird collides with a pipe
 * @param birdY Y position of bird
 * @param pipe Pipe to check collision with
 * @returns true if collision occurs
 */
const checkBirdHitsPipe = (birdY: number, pipe: Pipe): boolean => {
    const birdLeft = Constants.BIRD_X;
    const birdRight = Constants.BIRD_X + Birb.WIDTH;
    const birdTop = birdY;
    const birdBottom = birdY + Birb.HEIGHT;

    const pipeLeft = pipe.x;
    const pipeRight = pipe.x + Constants.PIPE_WIDTH;
    const gapTop = (pipe.gapY - pipe.gapHeight / 2) * Viewport.CANVAS_HEIGHT;
    const gapBottom = (pipe.gapY + pipe.gapHeight / 2) * Viewport.CANVAS_HEIGHT;

    // Check x value first
    if (birdRight > pipeLeft && birdLeft < pipeRight) {
        // then check y value
        return birdTop < gapTop || birdBottom > gapBottom;
    }
    return false;
};

/**
 * Determines which part of pipe was hit
 * @param birdY Y position of bird
 * @param pipe Pipe that was hit
 * @returns 'top' or 'bottom' based on collision location
 */
const getPipeCollisionType = (birdY: number, pipe: Pipe): "top" | "bottom" => {
    // we want to know whether we hit the top pipe or the bottom pipe
    const birdCenter = birdY + Birb.HEIGHT / 2;
    const gapCenter = pipe.gapY * Viewport.CANVAS_HEIGHT;
    return birdCenter < gapCenter ? "top" : "bottom";
};

/**
 * Generates random(with seed) bounce velocity
 * @param seed Current RNG seed
 * @param isUpward Whether bounce should be upward
 * @returns Tuple of [velocity, nextSeed]
 */
const generateBounceVelocity = (
    seed: number,
    isUpward: boolean,
): [number, number] => {
    // by random, this is actually not fully random, as fully random is impure
    // this achieves randomness by using hash function and seed
    // which means this is pure because it would generate the same result everytime if the seed is the same
    const nextSeed = RNG.hash(seed);
    const randomValue = RNG.scale(nextSeed);
    // Random velocity between 3 and 6
    const magnitude = 3 + Math.abs(randomValue) * 3;
    const velocity = isUpward ? -magnitude : magnitude;
    return [velocity, nextSeed];
};

/**
 * Allows the bird to flap with constant flap strength
 * @param s Current state
 * @returns Updated state with flap velocity
 */
const flap = (s: State): State => ({
    ...s,
    birdVelocity: Constants.FLAP_STRENGTH,
});

// Rendering (side effects)

/**
 * Brings an SVG element to the foreground.
 * @param elem SVG element to bring to the foreground
 */
const bringToForeground = (elem: SVGElement): void => {
    elem.parentNode?.appendChild(elem);
};

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "visible");
    bringToForeground(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "hidden");
};

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
): SVGElement => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

const render = (): ((s: State) => void) => {
    // Canvas elements
    const gameOver = document.querySelector("#gameOver") as SVGElement;
    const container = document.querySelector("#main") as HTMLElement;

    // Text fields
    const livesText = document.querySelector("#livesText") as HTMLElement;
    const scoreText = document.querySelector("#scoreText") as HTMLElement;

    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,
    );

    /**
     * Renders the current state to the canvas.
     *
     * In MVC terms, this updates the View using the Model.
     *
     * @param s Current state
     */
    return (s: State) => {
        svg.innerHTML = "";

        // Draw dynamic pipes from state
        s.pipes.forEach(pipe => {
            const gapTop = pipe.gapY - pipe.gapHeight / 2;
            const gapBottom = pipe.gapY + pipe.gapHeight / 2;

            // Top pipe
            const pipeTop = createSvgElement(svg.namespaceURI, "rect", {
                x: `${pipe.x}`,
                y: "0",
                width: `${Constants.PIPE_WIDTH}`,
                height: `${gapTop * Viewport.CANVAS_HEIGHT}`,
                fill: "green",
            });

            // Bottom pipe
            const pipeBottom = createSvgElement(svg.namespaceURI, "rect", {
                x: `${pipe.x}`,
                y: `${gapBottom * Viewport.CANVAS_HEIGHT}`,
                width: `${Constants.PIPE_WIDTH}`,
                height: `${(1 - gapBottom) * Viewport.CANVAS_HEIGHT}`,
                fill: "green",
            });

            svg.appendChild(pipeTop);
            svg.appendChild(pipeBottom);
        });
        // Draw ghost bird if it exists
        if (s.ghostPath.length > 0) {
            const ghostFrame = Math.floor(
                s.gameTime / (Constants.TICK_RATE_MS / 1000),
            );

            if (ghostFrame < s.ghostPath.length) {
                const ghostY = s.ghostPath[ghostFrame];

                const ghostImg = createSvgElement(svg.namespaceURI, "image", {
                    href: "assets/birb.png",
                    x: `${Constants.BIRD_X}`,
                    y: `${ghostY}`,
                    width: `${Birb.WIDTH}`,
                    height: `${Birb.HEIGHT}`,
                    opacity: "0.3",
                    filter: "grayscale(100%)",
                });
                svg.appendChild(ghostImg);
            }
        }
        // Update lives display
        livesText.textContent = `${s.lives}`;
        scoreText.textContent = `${s.score}`;

        // Show game over if no lives left
        if (s.gameEnd) {
            show(gameOver);
        }

        // Add birb to the main grid canvas, the reason we would do this after is because we want the element to be on top
        const birdImg = createSvgElement(svg.namespaceURI, "image", {
            href: "assets/birb.png",
            x: `${Constants.BIRD_X}`,
            y: `${s.birdY}`,
            width: `${Birb.WIDTH}`,
            height: `${Birb.HEIGHT}`,
        });
        // I found the Invulnerable to be hard to notice, so I added a Invulnerable flashing effect
        const isInvulnerable = s.gameTime < s.invulnerableUntil;
        if (isInvulnerable) {
            // Flash on and off every 100ms
            const flashCycle = Math.floor(s.gameTime * 10) % 2;
            birdImg.setAttribute("opacity", flashCycle === 0 ? "0.3" : "1");
        }
        svg.appendChild(birdImg);
    };
};

export const state$ = (csvContents: string): Observable<State> => {
    const allPipes = parseCSV(csvContents);

    const pipeSpawn$ = merge(
        ...allPipes.map(pipe =>
            timer(pipe.time * 1000).pipe(
                map(() => (s: State) => ({
                    ...s,
                    pipes: [...s.pipes, pipe],
                })),
            ),
        ),
    );

    /** User input */
    const flap$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
        filter(e => e.code === "Space"),
        map(() => (s: State) => flap(s)),
    );

    /** Determines the rate of time steps */
    const tick$ = interval(Constants.TICK_RATE_MS).pipe(
        // although we pass the allPipes
        map(() => tick(allPipes.length)),
    );

    /** Restart when player lost all lifes */
    const restart$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
        filter(e => e.code === "KeyR"),
        map(
            () => (s: State) =>
                s.gameEnd
                    ? {
                          ...initialState,
                          ghostPath: s.currentPath, // Transfer current path to ghost
                      }
                    : s,
        ),
    );
    /** Pause when player press P */
    const pause$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
        filter(e => e.code === "KeyP"),
        map(() => (s: State) => ({
            ...s,
            paused: !s.paused,
        })),
    );

    // merge to 1 state and scans it
    return merge(tick$, flap$, restart$, pipeSpawn$, pause$).pipe(
        scan((s, f) => f(s), initialState),
    );
};

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    const { protocol, hostname, port } = new URL(import.meta.url);
    const baseUrl = `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    const csvUrl = `${baseUrl}/assets/map.csv`;

    // Get the file from URL
    const csv$ = fromFetch(csvUrl).pipe(
        switchMap(response => {
            if (response.ok) {
                return response.text();
            } else {
                throw new Error(`Fetch error: ${response.status}`);
            }
        }),
        catchError(err => {
            console.error("Error fetching the CSV file:", err);
            throw err;
        }),
    );

    // Observable: wait for first user click
    const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

    csv$.pipe(
        switchMap(contents =>
            // On click - start the game
            click$.pipe(switchMap(() => state$(contents))),
        ),
    ).subscribe(render());
}
