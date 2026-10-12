import z from "zod";

export const PlatformContextSchema = z.object({
    platform: z
        .enum([
            "aix",
            "android",
            "darwin",
            "freebsd",
            "haiku",
            "linux",
            "openbsd",
            "sunos",
            "win32",
            "cygwin",
            "netbsd",
        ])
        .optional(),
    env: z.object().default({}).optional(),
    home: z.string().optional(),
});
export type PlatformContext = z.infer<typeof PlatformContextSchema>;
