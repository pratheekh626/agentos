import type { Task } from "../../core/Task";

export class DependencyManager {
  canStart(task: Task, tasks: Map<string, Task>): boolean {
    if (task.dependencies.length === 0) {
      return true;
    }

    return task.dependencies.every((dependencyId) => {
      const dependency = tasks.get(dependencyId);

      if (!dependency) {
        throw new Error(
          `Dependency not found: ${dependencyId}`
        );
      }

      return dependency.status === "completed";
    });
  }

  getBlockedDependencies(
    task: Task,
    tasks: Map<string, Task>
  ): Task[] {
    return task.dependencies
      .map((dependencyId) => tasks.get(dependencyId))
      .filter(
        (dependency): dependency is Task =>
          dependency !== undefined &&
          dependency.status !== "completed"
      );
  }

  hasCircularDependency(
    task: Task,
    tasks: Map<string, Task>,
    visited = new Set<string>()
  ): boolean {
    if (visited.has(task.id)) {
      return true;
    }

    visited.add(task.id);

    for (const dependencyId of task.dependencies) {
      const dependency = tasks.get(dependencyId);

      if (!dependency) {
        continue;
      }

      if (
        this.hasCircularDependency(
          dependency,
          tasks,
          new Set(visited)
        )
      ) {
        return true;
      }
    }

    return false;
  }
}
