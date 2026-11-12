import Link from "next/link";
import { formatDuration } from "@/lib/plan";
import { Play } from "./icons";

export type CourseCardData = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration_seconds: number;
};

export function CourseCard({ course }: { course: CourseCardData }) {
  return (
    <Link href={`/course/${course.id}`} className="course-card">
      <div className="course-thumb">
        {course.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="course-thumb-fallback">
            <Play size={28} />
          </div>
        )}
        <span className="course-duration">{formatDuration(course.duration_seconds)}</span>
        <span className="course-play">
          <Play size={16} />
        </span>
      </div>
      <div className="course-body">
        <h3 className="course-title">{course.title}</h3>
        <p className="course-author">{course.author}</p>
      </div>
    </Link>
  );
}
