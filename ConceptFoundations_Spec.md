# Cognitive Primitives PWA: Product & Technical Specification

This document details the product specification, technical architecture, observability strategy, and domain object model for a progressive web application designed to teach foundational cognitive primitives to toddlers via an iPad interface.

## 1. Project Inspiration & Core Philosophy

The genesis of this project lies in a fundamental question: *How many of our critical thinking skills are built upon isolated, foundational units of conceptual modeling?*

This application explores the direct transfer of these core conceptual blocks to young children through a hierarchical learning system. The goal is to facilitate **Accelerated Foundation Unit Dispersal** by packaging complex cognitive skills into small, highly digestible units.

### The Motivating Example: Same vs. Different
To understand this dispersal methodology, consider the transfer of a core concept like "same" versus "different" as a packaged, hierarchical learning unit:
*   **Step 1:** You show the child two different blocks. You say, *"Different."*
*   **Step 2:** You show them two identical blocks. You say, *"Same."*
*   **Step 3:** You give them a group of items where all are identical except for one outlier. You say, *"Identify the different one."*

Once the child successfully completes this loop, they have fundamentally acquired that unit of conceptual building. By mapping out the entire dependency tree of these cognitive primitives—from identity to magnitude, to spatial relationships and causality—we can deliver these building blocks through a highly accessible, purely virtual modality. Serving this frictionlessly as an iPad application (via a GitHub Pages PWA) enables rapid, measurable conceptual uptake.

## 2. Product Strategy & Curriculum

The application systematically introduces cognitive primitives (Identity, Magnitude, Spatial, Causality, Composition) using strict variable isolation and scaffolding. The environment must be highly deterministic, minimizing cognitive load beyond the target learning objective.

### The State Machine (Teaching Loop)
* **State 1: Expose.** Present target property. No interactive requirement.
* **State 2: Contrast.** Introduce delta variable. No interactive requirement.
* **State 3: Test.** Prompt for interaction. Evaluates acquisition of the primitive.
* **State 4: Generalize.** Alter non-target variables (e.g., change shapes to animals) to test abstract transfer.

## 3. UX Observability & Success Metrics

Because the users (toddlers) cannot provide verbal feedback, the application relies on deterministic event tracking to measure engagement, comprehension, and frustration limits. Every session is treated as an event stream, comparing expected interactions against actual touch data.

### Key Success Metrics (Parental Dashboard)

| Metric Name | Description | Indicator Of |
| :--- | :--- | :--- |
| **Time-to-First-Touch (TTFT)** | Latency between the audio prompt finishing and the first screen interaction. | Comprehension speed / Processing time. |
| **Miss Distance (Radius)** | Pixel distance from the edge of the correct target bounding box. | Motor control vs. intent. Differentiates "clumsy correct" from "wrong choice." |
| **Frustration Taps** | Rapid, repeated tapping (>3 within 1 second) on non-interactive or incorrect elements. | Cognitive overload or UX failure. Triggers step-down in difficulty. |
| **Generalization Transfer Rate** | Success rate on State 4 (Generalization) vs. State 3 (Test). | True conceptual acquisition vs. rote memorization of the visual pattern. |

## 4. Domain Object Model

The system is modeled to support event sourcing, allowing parents to replay or analyze specific learning modules. Below is the core object model schema.

```typescript
// Core Entities

enum ConceptType { IDENTITY, MAGNITUDE, SPATIAL, CAUSALITY, COMPOSITION }
enum TrialState { EXPOSE, CONTRAST, TEST, GENERALIZE }

interface CurriculumModule {
    id: UUID;
    concept: ConceptType;
    difficultyLevel: Int;
    prerequisites: List<ConceptType>;
    trials: List<Trial>;
}

interface Trial {
    id: UUID;
    moduleId: UUID;
    state: TrialState;
    targetElementId: String;          // The correct element to interact with
    distractorElementIds: List<String>;
    promptAudioURI: String;
    timeoutMs: Int;                   // Max time before automatic hint
}

// Observability & Telemetry Events

interface Session {
    id: UUID;
    userId: UUID;
    startTime: Timestamp;
    endTime: Timestamp;
    events: List<InteractionEvent>;
}

interface InteractionEvent {
    eventId: UUID;
    trialId: UUID;
    timestamp: Timestamp;
    type: EventType;                  // TAP, DRAG_START, DRAG_END, TIMEOUT
    coordinateX: Float;
    coordinateY: Float;
    hitElementId: String | null;      // Null if tapped on background
    isCorrectIntent: Boolean;         // Evaluated server/client side based on targetElementId
    timeSincePromptMs: Int;           // For TTFT calculation
}