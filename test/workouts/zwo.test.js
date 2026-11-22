/**
 * @jest-environment jsdom
 */

import { zwo } from '../../src/workouts/zwo.js';
import { repeat } from '../../src/functions.js';

import { JSDOM } from 'jsdom';

const parser = new DOMParser();

const removeWhiteSpace = (str) => str.replace(/\s/g,'');

describe('Zwo', () => {

    test('Zwo.read without textevents', () => {
        const input = `
        <workout_file>
            <author>Flux</author>
            <name>Test Workout</name>
            <category>Sweet Spot</category>
            <subcategory></subcategory>
            <description>Description of test workout</description>
            <sporttype>bike</sporttype>
            <tags></tags>
            <workout>
                <SteadyState Duration="10" Power="0.50"/>
                <SteadyState Duration="15" Power="0.90"/>
                <SteadyState Duration="10" Power="0.70" Slope="2.1" Cadence="90"/>
                <SteadyState Duration="15" Power="0.92" Cadence="80"/>
                <IntervalsT Repeat="2" OnDuration="40" OffDuration="20" OnPower="1.21" OffPower="0.7" OnSlope="4.8" OffSlope="0" />
                <SteadyState Duration="10" Cadence="90"/>
            </workout>
        </workout_file>`;

        const expected = {
            head: {
                author: 'Flux',
                name: "Test Workout",
                category: "Sweet Spot",
                subcategory: "",
                sportType: "bike",
                description: "Description of test workout",
                tags: "",
            },
            body: [
                {element: 'SteadyState', Duration: 10, Power: 0.50},
                {element: 'SteadyState', Duration: 15, Power: 0.90,},
                {element: 'SteadyState', Duration: 10, Power: 0.70, Slope: 2.1, Cadence: 90},
                {element: 'SteadyState', Duration: 15, Power: 0.92, Cadence: 80},
                {element: 'IntervalsT',  Repeat: 2, OnDuration: 40, OffDuration: 20, OnPower: 1.21, OffPower: 0.7, OnSlope: 4.8, OffSlope: 0},
                {element: 'SteadyState', Duration: 10, Cadence: 90},
            ],
        };

        let res = zwo.read(input);

        expect(res).toStrictEqual(expected);
    });

    test('Zwo.read with textevents', () => {
        const input = `
            <workout_file>
                <author>Flux</author>
                <name>Test Workout</name>
                <category>Sweet Spot</category>
                <subcategory></subcategory>
                <description>Description of test workout</description>
                <sporttype>bike</sporttype>
                <tags></tags>
                <workout>
                    <SteadyState Duration="10" Power="0.50">
                        <textevent timeoffset="0" message="01 SteadyState 01 message +00 10s" duration="10" />
                    </SteadyState>
                    <SteadyState Duration="20" Power="0.90">
                        <textevent timeoffset="0" message="02 SteadyState 01 message +00 10s" duration="10" />
                        <textevent timeoffset="10" message="02 SteadyState 02 message +10 10s" duration="10" />
                    </SteadyState>
                    <SteadyState Duration="60" Power="0.50">
                        <textevent timeoffset="10" message="03 SteadyState 01 message +10 10s" duration="10" />
                        <textevent timeoffset="30" message="03 SteadyState 02 message +30 10s" duration="10" />
                        <textevent timeoffset="50" message="03 SteadyState 03 message +50 10s" duration="10" />
                    </SteadyState>
                    <FreeRide Duration="10">
                        <textevent timeoffset="0" message="04 FreeRide 01 message +00 10s" duration="10" />
                    </FreeRide>
                    <IntervalsT Repeat="2" OnDuration="10" OffDuration="5" OnPower="1.21" OffPower="0.7">
                        <textevent timeoffset="0" message="05 IntervalsT 01 interval 01 message +00 10s" duration="10" />
                        <textevent timeoffset="10" message="05 IntervalsT 02 interval 01 message +00 05s" duration="5" />
                        <textevent timeoffset="15" message="05 IntervalsT 03 interval 01 message +00 10s" duration="10" />
                        <textevent timeoffset="25" message="05 IntervalsT 04 interval 01 message +00 05s" duration="5" />
                    </IntervalsT>
                </workout>
            </workout_file>`;

        const expected = {
            head: {
                author: 'Flux',
                name: "Test Workout",
                category: "Sweet Spot",
                subcategory: "",
                sportType: "bike",
                description: "Description of test workout",
                tags: "",
            },
            body: [
                {element: 'SteadyState', Duration: 10, Power: 0.50, children: [
                    {element: 'TextEvent', duration: 10, timeoffset: 0, message: "01 SteadyState 01 message +00 10s"}
                    ]
                },
                {element: 'SteadyState', Duration: 20, Power: 0.90, children: [
                    {element: 'TextEvent', duration: 10, timeoffset: 0, message: "02 SteadyState 01 message +00 10s"},
                    {element: 'TextEvent', duration: 10, timeoffset: 10, message: "02 SteadyState 02 message +10 10s"}
                ]
                },
                {element: 'SteadyState', Duration: 60, Power: 0.50, children: [
                    {element: 'TextEvent', duration: 10, timeoffset: 10, message: "03 SteadyState 01 message +10 10s"},
                    {element: 'TextEvent', duration: 10, timeoffset: 30, message: "03 SteadyState 02 message +30 10s"},
                    {element: 'TextEvent', duration: 10, timeoffset: 50, message: "03 SteadyState 03 message +50 10s"}
                    ]
                },
                {element: 'FreeRide', Duration: 10, children: [
                    {element: 'TextEvent', duration: 10, timeoffset: 0, message: "04 FreeRide 01 message +00 10s"}
                    ]
                },
                {element: 'IntervalsT', Repeat: 2, OnDuration: 10, OffDuration: 5, OnPower: 1.21, OffPower: 0.7, children: [
                    {element: 'TextEvent', duration: 10, timeoffset: 0, message: "05 IntervalsT 01 interval 01 message +00 10s"},
                    {element: 'TextEvent', duration: 5, timeoffset: 10, message: "05 IntervalsT 02 interval 01 message +00 05s"},
                    {element: 'TextEvent', duration: 10, timeoffset: 15, message: "05 IntervalsT 03 interval 01 message +00 10s"},
                    {element: 'TextEvent', duration: 5, timeoffset: 25, message: "05 IntervalsT 04 interval 01 message +00 05s"}
                    ]
                }
            ],
        };

        let res = zwo.read(input);

        expect(res).toStrictEqual(expected);
    });

    test('Zwo.readToInterval without textevents', () => {
        const input = `
        <workout_file>
            <author>Flux</author>
            <name>Test Workout</name>
            <category>Sweet Spot</category>
            <subcategory></subcategory>
            <description>Description of test workout</description>
            <sporttype>bike</sporttype>
            <tags></tags>
            <workout>
                <SteadyState Duration="10" Power="0.50"/>
                <SteadyState Duration="15" Power="0.90"/>
                <SteadyState Duration="10" Power="0.70" Slope="2.1" Cadence="90"/>
                <SteadyState Duration="15" Power="0.92" Cadence="80"/>
                <IntervalsT Repeat="2" OnDuration="40" OffDuration="20" OnPower="1.21" OffPower="0.7" OnSlope="4.8" OffSlope="0" />
                <SteadyState Duration="10" Cadence="90"/>
            </workout>
        </workout_file>`;

        const expected = {
            // id: "{1ec20f99-b3d8-4eb9-c000-be96e947897a}",
            meta: {
                author: 'Flux',
                name: "Test Workout",
                category: "Sweet Spot",
                subcategory: "",
                sportType: "bike",
                description: "Description of test workout",
                tags:"",
                duration: 3 * 60, // 60s
            },
            intervals: [
                {duration: 10, steps: [{duration: 10, power: 0.50}]},
                {duration: 15, steps: [{duration: 15, power: 0.90}]},
                {duration: 10, steps: [
                    {duration: 10, power: 0.70, slope: 2.1, cadence: 90}]},
                {duration: 15, steps: [{duration: 15, power: 0.92, cadence: 80}]},
                {duration: 40, steps: [{duration: 40, power: 1.21, slope: 4.8}]},
                {duration: 20, steps: [{duration: 20, power: 0.7, slope: 0.0}]},
                {duration: 40, steps: [{duration: 40, power: 1.21, slope: 4.8}]},
                {duration: 20, steps: [{duration: 20, power: 0.7, slope: 0.0}]},
                {duration: 10, steps: [{duration: 10, power: 0, slope: 0, cadence: 90}]},
            ],
        };

        let res = zwo.readToInterval(input);

        expect(res).toStrictEqual(expected);
    });

    test('Zwo.readToInterval with text events', () => {
        const input = `
            <workout_file>
                <author>Flux</author>
                <name>Test Workout</name>
                <category>Sweet Spot</category>
                <subcategory></subcategory>
                <description>Description of test workout</description>
                <sporttype>bike</sporttype>
                <tags></tags>
                <workout>
                    <SteadyState Duration="10" Power="0.50">
                        <textevent timeoffset="0" message="01 SteadyState 01 message +00 10s" duration="10" />
                    </SteadyState>
                    <SteadyState Duration="20" Power="0.90">
                        <textevent timeoffset="0" message="02 SteadyState 01 message +00 10s" duration="10" />
                        <textevent timeoffset="10" message="02 SteadyState 02 message +10 10s" duration="10" />
                    </SteadyState>
                    <SteadyState Duration="60" Power="0.50">
                        <textevent timeoffset="10" message="03 SteadyState 01 message +10 10s" duration="10" />
                        <textevent timeoffset="30" message="03 SteadyState 02 message +30 10s" duration="10" />
                        <textevent timeoffset="50" message="03 SteadyState 03 message +50 10s" duration="10" />
                    </SteadyState>
                    <FreeRide Duration="10">
                        <textevent timeoffset="0" message="04 FreeRide 01 message +00 10s" duration="10" />
                    </FreeRide>
                    <IntervalsT Repeat="2" OnDuration="10" OffDuration="5" OnPower="1.21" OffPower="0.7">
                        <textevent timeoffset="0" message="05 IntervalsT 01 interval 01 message +00 10s" duration="10" />
                        <textevent timeoffset="10" message="05 IntervalsT 02 interval 01 message +00 05s" duration="5" />
                        <textevent timeoffset="15" message="05 IntervalsT 03 interval 01 message +00 10s" duration="10" />
                        <textevent timeoffset="25" message="05 IntervalsT 04 interval 01 message +00 05s" duration="5" />
                    </IntervalsT>
                </workout>
            </workout_file>`;

        const expected = {
            // id: "{1ec20f99-b3d8-4eb9-c000-be96e947897a}",
            meta: {
                author: 'Flux',
                name: "Test Workout",
                category: "Sweet Spot",
                subcategory: "",
                sportType: "bike",
                description: "Description of test workout",
                tags: "",
                duration: 10+20+60+10+10+5+10+5, // 130s 00:02:10
            },
            intervals: [
                {duration: 10, steps: [{duration: 10, power: 0.50, messages: [
                    {duration: 10, offset: 0, message: "01 SteadyState 01 message +00 10s"},
                ]}]},
                {duration: 20, steps: [{duration: 20, power: 0.90, messages: [
                    {duration: 10, offset: 0, message: "02 SteadyState 01 message +00 10s"},
                    {duration: 10, offset: 10, message: "02 SteadyState 02 message +10 10s"},
                ]}]},
                {duration: 60, steps: [{duration: 60, power: 0.50, messages: [
                    {duration: 10, offset: 10, message: "03 SteadyState 01 message +10 10s"},
                    {duration: 10, offset: 30, message: "03 SteadyState 02 message +30 10s"},
                    {duration: 10, offset: 50, message: "03 SteadyState 03 message +50 10s"},
                ]}]},
                {duration: 10, steps: [{duration: 10, power: 0, slope: 0, messages: [
                    {duration: 10, offset: 0, message: "04 FreeRide 01 message +00 10s"},
                ]}]},
                {duration: 10, steps: [{duration: 10, power: 1.21, messages: [
                    {duration: 10, offset: 0, message: "05 IntervalsT 01 interval 01 message +00 10s"},
                ]}]},
                {duration: 5, steps: [{duration: 5, power: 0.70, messages: [
                    {duration: 5, offset: 0, message: "05 IntervalsT 02 interval 01 message +00 05s"},
                ]}]},
                {duration: 10, steps: [{duration: 10, power: 1.21, messages: [
                    {duration: 10, offset: 0, message: "05 IntervalsT 03 interval 01 message +00 10s"},
                ]}]},
                {duration: 5, steps: [{duration: 5, power: 0.70, messages: [
                    {duration: 5, offset: 0, message: "05 IntervalsT 04 interval 01 message +00 05s"},
                ]}]},
            ],
        };

        let res = zwo.readToInterval(input);

        expect(res).toStrictEqual(expected);
    });

    test('Zwo.readToInterval textevent without timeoffset starts with the block', () => {
        // as exported by Intervals.icu for step text
        const input = `
        <workout_file>
            <workout>
                <SteadyState show_avg="1" Power="0.55" Duration="1800">
                    <textevent message="Press lap" duration="10"/>
                </SteadyState>
                <SteadyState show_avg="1" Power="0.91" Duration="1500"/>
                <IntervalsT Repeat="2" OnDuration="10" OffDuration="5" OnPower="1.2" OffPower="0.5">
                    <textevent message="Go" duration="5"/>
                </IntervalsT>
            </workout>
        </workout_file>`;

        const res = zwo.readToInterval(input);

        expect(res.intervals[0].steps[0].messages).toStrictEqual([
            {duration: 10, offset: 0, message: 'Press lap'},
        ]);
        expect(res.intervals[1].steps[0].messages).toBeUndefined();
        expect(res.intervals[2].steps[0].messages).toStrictEqual([
            {duration: 5, offset: 0, message: 'Go'},
        ]);
        expect(res.intervals[3].steps[0].messages).toBeUndefined();
        expect(res.intervals[4].steps[0].messages).toBeUndefined();
    });
});

describe('Zwo SteadyState power range', () => {
    const toInterval = (attrs) => {
        const input = `
        <workout_file>
            <workout>
                <SteadyState ${attrs}/>
            </workout>
        </workout_file>`;
        return zwo.readToInterval(input).intervals[0];
    };

    test('Power only has no range', () => {
        expect(toInterval(`Duration="60" Power="0.75"`)).toStrictEqual(
            {duration: 60, steps: [{duration: 60, power: 0.75}]}
        );
    });

    test('PowerLow and PowerHigh keep the range, power is the midpoint', () => {
        const res  = toInterval(`show_avg="1" PowerHigh="0.932" PowerLow="0.898" Duration="1500"`);
        const step = res.steps[0];

        expect(res.duration).toBe(1500);
        expect(step.duration).toBe(1500);
        expect(step.powerLow).toBe(0.898);
        expect(step.powerHigh).toBe(0.932);
        expect(step.power).toBeCloseTo(0.915, 10);
        expect(step).not.toHaveProperty('powerlow');
        expect(step).not.toHaveProperty('powerhigh');
    });

    test('reversed PowerLow and PowerHigh are ordered', () => {
        const step = toInterval(`Duration="60" PowerLow="0.9" PowerHigh="0.8"`).steps[0];

        expect(step.powerLow).toBe(0.8);
        expect(step.powerHigh).toBe(0.9);
        expect(step.power).toBeCloseTo(0.85, 10);
    });

    test('only one bound is a single target without range', () => {
        expect(toInterval(`Duration="60" PowerLow="0.6"`)).toStrictEqual(
            {duration: 60, steps: [{duration: 60, power: 0.6}]}
        );
        expect(toInterval(`Duration="60" PowerHigh="0.7"`)).toStrictEqual(
            {duration: 60, steps: [{duration: 60, power: 0.7}]}
        );
    });

    test('Power wins as target, range is kept', () => {
        const step = toInterval(`Duration="60" Power="0.8" PowerLow="0.75" PowerHigh="0.9"`).steps[0];

        expect(step).toStrictEqual({duration: 60, power: 0.8, powerLow: 0.75, powerHigh: 0.9});
    });

    test('range works with cadence range and text events', () => {
        const input = `
        <workout_file>
            <workout>
                <SteadyState Duration="300" PowerLow="0.5" PowerHigh="0.6" CadenceLow="85" CadenceHigh="95">
                    <textevent timeoffset="0" message="Settle in" duration="10"/>
                </SteadyState>
            </workout>
        </workout_file>`;

        const step = zwo.readToInterval(input).intervals[0].steps[0];

        expect(step.powerLow).toBe(0.5);
        expect(step.powerHigh).toBe(0.6);
        expect(step.power).toBeCloseTo(0.55, 10);
        expect(step.cadence).toBe(90);
        expect(step.messages).toStrictEqual([{duration: 10, offset: 0, message: 'Settle in'}]);
    });

    test('fromInterval writes the range back', () => {
        const interval = {duration: 1500, steps: [
            {duration: 1500, power: 0.915, powerLow: 0.898, powerHigh: 0.932},
        ]};

        expect(zwo.Elements.SteadyState.fromInterval(interval)).toStrictEqual({
            element: 'SteadyState', Duration: 1500, PowerLow: 0.898, PowerHigh: 0.932,
        });
    });

    test('fromInterval without range writes Power', () => {
        const interval = {duration: 60, steps: [{duration: 60, power: 0.75, cadence: 90}]};

        expect(zwo.Elements.SteadyState.fromInterval(interval)).toStrictEqual({
            element: 'SteadyState', Duration: 60, Power: 0.75, Cadence: 90,
        });
    });

    test('range survives write and read', () => {
        const input = `
        <workout_file>
            <author>Test</author>
            <name>Sweet Spot Range</name>
            <description>Range test</description>
            <sportType>bike</sportType>
            <tags/>
            <workout>
                <SteadyState Duration="600" PowerLow="0.474" PowerHigh="0.644"/>
                <SteadyState Duration="1500" PowerLow="0.898" PowerHigh="0.932"/>
                <SteadyState Duration="300" Power="0.5"/>
            </workout>
        </workout_file>`;

        const workout = zwo.readToInterval(input);
        const output  = zwo.write(zwo.fromInterval(workout));
        const again   = zwo.readToInterval(output);

        expect(again.intervals).toStrictEqual(workout.intervals);
        expect(again.intervals[1].steps[0].powerLow).toBe(0.898);
        expect(again.intervals[1].steps[0].powerHigh).toBe(0.932);
    });
});
