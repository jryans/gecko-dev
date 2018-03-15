# General

- Some concept of "run at" to say that an actor runs per-frame vs. per-process?
   - `runAt: "process"`
   - `runFilter: process => process.type == <parent>`
   - a tool should have to explicitly register interest in other processes
     before actors will start running in it.
- Is there a generic way to keep actors filter to one tab, rather than each
  content type making up their own plan?
- Would be nice to centralize the window, etc. filtering used by at least
  console and network.  Should resource discovery pre-filter for you?
  - We should at least gather the IDs used for filtering onto the tab actor
    instead of leaving it for console / network helpers to retrieve
  - Filtering options should be passed around together as an object

# Console

- Browser Console wants to connect to main and content processes vs. Console
  wants the content process for the context
  - Chrome vs Content filtering is separate; about privs, not processes.

# Network

- We want to observe network requests in the parent / SW processes where they
  happen
  - Do we want to change the default actor relationship?  Should all actors
    first load in the parent and then optionally load in frames as needed...?

# Targets vs. Frames

- The minimum level would be one target per process boundary
  - This appears to match Chrome's design
- At the extreme end though, each frame could be a separate target...
  - Worse for perf with all the extra stuff to load
  - Would need to invent some machinery allow server startup, message passing
    for in-process frames

# Naming

- Use `context` in actors, instead of strange `tabActor` name?

# Cleanup

- Teach fronts how to find their own actor names?  (Might require root actor to
  be converted first.)
- Remove `activeConsole` from targets?