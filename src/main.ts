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
    TICK_RATE_MS: 20, // Might need to change this!
    GRAVITY: 0.5,
    FLAP_STRENGTH: -8,
    BIRD_X: 100,
} as const;

// User input

type Key = "Space";

// State processing

type State = Readonly<{
    birdY: number;
    birdVelocity: number;
    gameTime: number;
    // array to store the pipes
    pipes: ReadonlyArray<Pipe>;
    gameEnd: boolean;
}>;

// pipe class, we store these at the state
type Pipe = Readonly<{
    id: number;
    x: number;
    gapY: number;
    gapHeight: number;
    passed: boolean;
    time: number;
}>;

const initialState: State = {
    birdY: Viewport.CANVAS_HEIGHT / 2 - Birb.HEIGHT / 2,
    birdVelocity: 0,
    pipes: [],
    gameTime: 0,
    gameEnd: false,
};

/**
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick = (s: State): State => {
    const velocity = s.birdVelocity + Constants.GRAVITY;
    const y = s.birdY + velocity;

    // control the Y to not go off screen
    const clampedY = Math.max(
        0,
        Math.min(Viewport.CANVAS_HEIGHT - Birb.HEIGHT, y),
    );

    return {
        ...s,
        birdY: clampedY,
        birdVelocity: velocity,
    };
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
        // Add birb to the main grid canvas
        const birdImg = createSvgElement(svg.namespaceURI, "image", {
            href: "assets/birb.png",
            x: `${Constants.BIRD_X}`,
            y: `${s.birdY}`,
            width: `${Birb.WIDTH}`,
            height: `${Birb.HEIGHT}`,
        });
        svg.appendChild(birdImg);

        // Draw a static pipe as a demonstration
        const pipeGapY = 200; // vertical center of the gap
        const pipeGapHeight = 100;

        // Top pipe
        const pipeTop = createSvgElement(svg.namespaceURI, "rect", {
            x: "150",
            y: "0",
            width: `${Constants.PIPE_WIDTH}`,
            height: `${pipeGapY - pipeGapHeight / 2}`,
            fill: "green",
        });

        // Bottom pipe
        const pipeBottom = createSvgElement(svg.namespaceURI, "rect", {
            x: "150",
            y: `${pipeGapY + pipeGapHeight / 2}`,
            width: `${Constants.PIPE_WIDTH}`,
            height: `${Viewport.CANVAS_HEIGHT - (pipeGapY + pipeGapHeight / 2)}`,
            fill: "green",
        });

        svg.appendChild(pipeTop);
        svg.appendChild(pipeBottom);
    };
};

export const state$ = (csvContents: string): Observable<State> => {
    /** User input */
    const flap$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
        filter(e => e.code === "Space"),
        map(() => (s: State) => flap(s)),
    );

    /** Determines the rate of time steps */
    const tick$ = interval(Constants.TICK_RATE_MS).pipe(
        map(() => (s: State) => tick(s)),
    );
    // merge both to 1 state and scans it
    return merge(tick$, flap$).pipe(scan((s, f) => f(s), initialState));
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
