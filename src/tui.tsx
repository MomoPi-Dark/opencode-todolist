import { Plugin } from "@opencode/plugin/tui";
import { RendererContext } from "@opentui/solid";
import { TodoProgress } from "./tui/todo-panel";

export default Plugin.define({
  id: "opencode.todolist.tui",
  setup(context) {
    const releaseSlot = context.ui.slot({
      append: "session.composer.top",
      render: (props) => {
        const directory = context.data.session.get(props.sessionID)?.location
          .directory;
        if (!directory) return null;

        return (
          <RendererContext.Provider value={context.renderer}>
            <TodoProgress context={context} sessionID={props.sessionID} />
          </RendererContext.Provider>
        );
      },
    });

    return () => {
      releaseSlot();
    };
  },
});
