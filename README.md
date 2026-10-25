# cal-hacks-13
Band: The only band you need

BandIt is the only band you need for a public event. 

When you join an event you are given the BandIt band. You create an account using our web app by tapping the band itself (NFC). You connect with your social media accounts, medical history, and insurance.

Each band uses bluetooth to locate itself amongst other bands. Combined with the venue cameras, this 2-step system allows a detail spacial-time map of the whole event with all the people.

## Accidents

Each year there are over preventable 44,500 deaths and 15,6M injuries in public venues. 34% of those accidents occurred due to falls. 

The biggest risk when somebody fall is getting crowd crush. With the bands and the cameras, we track high risk areas of crowd crushes. When somebody falls, the bands of all the people around them start vibrating and flashing red. 

The band compass points the people towards the optimal dispersion route so that they don't crush the fallen person.

In case of other emergencies such as fires, when the visible is low, the bands serve to help move the people towards the nearest exit using the LEDs.

In case there is a paramedic coming in, the bands point towards how the people should disperse.

Using the bands, we can also disperse high risk areas before accidents occur.

## Insurance

The accident tracking systems allows us to reconcile accidents early with insurance companies. For the venue itself, the camera systems also allows for early tracking of other systems falling. For example somebody breaks a speaker, how is that accident going to be detected. 

## Social

The spacial-time map allows people who had special moments together to find who they hung out with at the venue afterwards.

Remember the time you met an awesome person at a concert but forgot to get their Insta, that's the case we solving. You will be able to find them after the event. 

Similarly, when you hung out at a boot at an event, you can always see in the afterwards summary of your event what you did, when you did it. 

You will get a special link with spacetime history, your most visited booths, and the socials of the people you hung out it.

Each time a photographer takes a picture of the event, we extract the meta data and the features of the photo, combining them with the spacetime map of the bands, so that we can figure out the exact people at each photo. Those are also given to your summary. You have an easy way to share them and tag all the people needed on social media.

## Shopping

While it is awesome to connect with people at events, what's even better is to be able to save the memories. 

In your final summary, from the information about where you hung out it, let's say a specific band a concert, we create personalized merchandise with you and the people you hung out with. 

Imagine after the event getting shirts and cups with you and the memories with your friends. 

Instead of having to buy merch at the event, and not being able to get more because your hands got full, you can now, just get what you like most in the end. This is how we reimagine shopping using agents.

## Repository

- [`frontend/`](frontend/README.md): the BandIt Safety Command Center (React, PixiJS 8). `cd frontend && npm install && npm run dev` runs the full demo in simulation mode, no hardware or backend needed.
- [`docs/BACKEND_INTEGRATION.md`](docs/BACKEND_INTEGRATION.md): the REST and WebSocket contract the frontend expects from the Rust backend.

The MVP covers the safety workflow only: SOS and fall incidents, camera evidence, responder corridors and staff-approved band guidance. The social, insurance and merchandise ideas above are out of scope for it.
