import { Plugin } from "@opencode/plugin/tui";
import { RendererContext } from "@opentui/solid";
import { TodoProgress } from "./tui/todo-panel";

export default Plugin.define({
  id: "todolist.tui",
  setup(context) {
    const releaseSlot = context.ui.slot({
      append: "session.composer.top",
      render: (props) => {
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
